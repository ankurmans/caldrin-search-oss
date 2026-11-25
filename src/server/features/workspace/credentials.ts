import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { workspaceCredentials, workspaceSettings } from "@/db/schema";
import { getAuthMode } from "@/lib/auth-mode";
import { isByokPreview } from "@/lib/byok-preview";
import { openSecret, sealSecret } from "@/server/lib/secret-box";

export type CredentialKind =
  | "dataforseo"
  | "tinyfish"
  | "llm"
  // Answer-engine keys, called directly by the engine's own API.
  | "anthropic"
  | "perplexity"
  | "openai"
  | "gemini";

type WorkspaceCredential = {
  kind: CredentialKind;
  provider: string;
  apiKey: string;
  accountId: string | null;
  modelFast: string | null;
  modelSmart: string | null;
};

const CACHE_TTL_MS = 30_000;
export type WorkspaceMode = "trial" | "byok" | "cloud";

const modeCache = new Map<string, { value: WorkspaceMode; at: number }>();
const credentialCache = new Map<
  string,
  { value: WorkspaceCredential | null; at: number }
>();

function fresh(at: number) {
  return Date.now() - at < CACHE_TTL_MS;
}

// "cloud" spends the deployment's keys without limit, so it must be explicit:
// only a row the operator wrote (or the grandfathering migration) says so, and
// no request can set it. "trial" spends them up to the trial budget (trial.ts).
// A workspace with no row runs on its own keys. Other auth modes have
// no per-workspace keys at all and always use the deployment's.
export async function getWorkspaceMode(
  organizationId: string,
  options?: { fresh?: boolean },
): Promise<WorkspaceMode> {
  // The open edition never spends deployment keys, whatever a stored row says.
  if (isByokPreview) return "byok";
  const hit = modeCache.get(organizationId);
  if (!options?.fresh && hit && fresh(hit.at)) return hit.value;
  const [row] = await db
    .select({ mode: workspaceSettings.mode })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.organizationId, organizationId))
    .limit(1);
  const fallback = getAuthMode(env.AUTH_MODE) === "password" ? "byok" : "cloud";
  const value = row?.mode ?? fallback;
  modeCache.set(organizationId, { value, at: Date.now() });
  return value;
}

export async function setWorkspaceMode(
  organizationId: string,
  mode: WorkspaceMode,
) {
  await db
    .insert(workspaceSettings)
    .values({ organizationId, mode })
    .onConflictDoUpdate({
      target: workspaceSettings.organizationId,
      set: { mode },
    });
  modeCache.delete(organizationId);
}

export async function getCredential(
  organizationId: string,
  kind: CredentialKind,
  options?: { fresh?: boolean },
): Promise<WorkspaceCredential | null> {
  const cacheKey = `${organizationId}:${kind}`;
  const hit = credentialCache.get(cacheKey);
  if (!options?.fresh && hit && fresh(hit.at)) return hit.value;
  const [row] = await db
    .select()
    .from(workspaceCredentials)
    .where(
      and(
        eq(workspaceCredentials.organizationId, organizationId),
        eq(workspaceCredentials.kind, kind),
      ),
    )
    .limit(1);
  const apiKey = row ? await openSecret(row.apiKeyEncrypted) : null;
  const value =
    row && apiKey
      ? {
          kind,
          provider: row.provider,
          apiKey,
          accountId: row.accountId,
          modelFast: row.modelFast,
          modelSmart: row.modelSmart,
        }
      : null;
  credentialCache.set(cacheKey, { value, at: Date.now() });
  return value;
}

export async function saveCredential(
  organizationId: string,
  input: {
    kind: CredentialKind;
    provider: string;
    apiKey: string;
    accountId?: string | null;
    modelFast?: string | null;
    modelSmart?: string | null;
  },
) {
  const apiKeyEncrypted = await sealSecret(input.apiKey);
  const keyHint = input.apiKey.slice(-4);
  const now = new Date().toISOString();
  await db
    .insert(workspaceCredentials)
    .values({
      organizationId,
      kind: input.kind,
      provider: input.provider,
      apiKeyEncrypted,
      keyHint,
      accountId: input.accountId ?? null,
      modelFast: input.modelFast ?? null,
      modelSmart: input.modelSmart ?? null,
    })
    .onConflictDoUpdate({
      target: [workspaceCredentials.organizationId, workspaceCredentials.kind],
      set: {
        provider: input.provider,
        apiKeyEncrypted,
        keyHint,
        accountId: input.accountId ?? null,
        modelFast: input.modelFast ?? null,
        modelSmart: input.modelSmart ?? null,
        updatedAt: now,
      },
    });
  credentialCache.delete(`${organizationId}:${input.kind}`);
}

export async function deleteCredential(
  organizationId: string,
  kind: CredentialKind,
) {
  await db
    .delete(workspaceCredentials)
    .where(
      and(
        eq(workspaceCredentials.organizationId, organizationId),
        eq(workspaceCredentials.kind, kind),
      ),
    );
  credentialCache.delete(`${organizationId}:${kind}`);
}

// What Settings shows: which keys exist and their last four characters,
// never the keys themselves.
export async function listCredentialStatus(organizationId: string) {
  const rows = await db
    .select({
      kind: workspaceCredentials.kind,
      provider: workspaceCredentials.provider,
      keyHint: workspaceCredentials.keyHint,
      accountId: workspaceCredentials.accountId,
      modelFast: workspaceCredentials.modelFast,
      modelSmart: workspaceCredentials.modelSmart,
    })
    .from(workspaceCredentials)
    .where(eq(workspaceCredentials.organizationId, organizationId));
  return { mode: await getWorkspaceMode(organizationId), credentials: rows };
}
