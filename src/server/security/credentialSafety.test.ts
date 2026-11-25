import type { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import { getConnectionSummary } from "@/server/features/content/services/shopifyConnection";
import {
  listCredentialStatus,
  saveCredential,
} from "@/server/features/workspace/credentials";
import { sealSecret } from "@/server/lib/secret-box";
import { createMigratedDatabase } from "./sqlite-test-db";

const state = vi.hoisted(() => ({
  database: null as DatabaseSync | null,
  workerEnv: {} as Record<string, string>,
}));
vi.mock("cloudflare:workers", () => ({ env: state.workerEnv }));
vi.mock("@/db", async () => {
  const { createProxyDb } = await import("./sqlite-test-db");
  return { db: createProxyDb(() => state.database) };
});

const PLAIN_KEY = "sk-live-PLAINTEXT-0123456789";
const PLAIN_ACCESS = "shpat_PLAINTEXT_ACCESS_token";
const PLAIN_REFRESH = "shprt_PLAINTEXT_REFRESH_token";

beforeEach(() => {
  state.workerEnv.BETTER_AUTH_SECRET = "test-secret-for-sealing-values";
  state.workerEnv.AUTH_MODE = "password";
  state.database?.close();
  state.database = createMigratedDatabase();
});

// A secret must not appear anywhere in what a summary returns: not as the
// plaintext, not as the sealed ciphertext, not under a token-like key name.
function expectNoSecrets(result: unknown, secrets: string[]) {
  const text = JSON.stringify(result);
  for (const secret of secrets) expect(text).not.toContain(secret);
  expect(text).not.toMatch(
    /"[^"]*(encrypted|sealed|secret|token|apikey)[^"]*":/i,
  );
}

describe("credential summaries", () => {
  it("returns only the last four characters of a workspace key, never the key or its sealed value", async () => {
    await saveCredential("org-1", {
      kind: "llm",
      provider: "openrouter",
      apiKey: PLAIN_KEY,
    });
    const [row] =
      state.database
        ?.prepare("SELECT api_key_encrypted FROM workspace_credentials")
        .all() ?? [];
    const sealed = String(row?.api_key_encrypted);
    expect(sealed).not.toContain(PLAIN_KEY);

    // This is what the getWorkspaceKeys server function returns to owners.
    const status = await listCredentialStatus("org-1");
    expectNoSecrets(status, [PLAIN_KEY, sealed]);
    expect(status.credentials).toEqual([
      expect.objectContaining({ kind: "llm", keyHint: PLAIN_KEY.slice(-4) }),
    ]);
  });

  it("returns no Shopify token, sealed or plain, in the connection summary", async () => {
    const sealedAccess = await sealSecret(PLAIN_ACCESS);
    const sealedRefresh = await sealSecret(PLAIN_REFRESH);
    await ContentRepository.upsertConnection({
      projectId: "project-a",
      organizationId: "org-1",
      shopDomain: "a.myshopify.com",
      mode: "live",
      sealedAccessToken: sealedAccess,
      sealedRefreshToken: sealedRefresh,
      accessTokenExpiresAt: "2026-12-01T00:00:00Z",
      grantedScopes: "read_content,write_content",
      canPublish: true,
      apiVersion: "2025-10",
      connectedByUserId: "user-a",
    });
    const summary = await getConnectionSummary("project-a");
    expect(summary).toMatchObject({ shopDomain: "a.myshopify.com" });
    expectNoSecrets(summary, [
      PLAIN_ACCESS,
      PLAIN_REFRESH,
      sealedAccess,
      sealedRefresh,
    ]);
  });
});

// Sealed columns hold live credentials. Only the files that own them may name
// the fields, so a new feature cannot return a connection row by accident
// without this list (and a reviewer) noticing.
const SEALED_FIELD = /apiKeyEncrypted|sealedAccessToken|sealedRefreshToken/;
const MAY_NAME_SEALED_FIELDS = [
  "src/db/",
  "src/server/features/workspace/credentials.ts",
  "src/server/features/content/repositories/ShopifyConnectionRepository.ts",
  "src/server/features/content/services/shopifyConnection.ts",
  // Asserts the OAuth callback stores the token sealed; it never returns it.
  "src/server/features/content/services/shopifyOAuthConnect.test.ts",
  "src/server/security/",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("sealed credential fields", () => {
  it("are referenced only by the files that own them", () => {
    const offenders = sourceFiles("src")
      .filter(
        (file) => !MAY_NAME_SEALED_FIELDS.some((ok) => file.startsWith(ok)),
      )
      .filter((file) => SEALED_FIELD.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
