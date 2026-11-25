import { sha256Hex } from "@/server/lib/audit/ids";
import { AttributionLedgerRepository as ledger } from "../repositories/AttributionLedgerRepository";

type KeyKind = "public" | "secret";

const PREFIX: Record<KeyKind, string> = {
  public: "cldr_pk_",
  secret: "cldr_sk_",
};
const LAST_USED_REFRESH_MS = 10 * 60 * 1000;

function newKey(kind: KeyKind) {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const body = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${PREFIX[kind]}${body}`;
}

/** Replaces the project's key of this kind. The new key is returned once. */
export async function rotateAttributionKey(projectId: string, kind: KeyKind) {
  const key = newKey(kind);
  const now = new Date().toISOString();
  await ledger.revokeKeys(projectId, kind, now);
  await ledger.insertKey({
    id: crypto.randomUUID(),
    projectId,
    kind,
    keyHash: await sha256Hex(key),
    prefix: key.slice(0, PREFIX[kind].length + 4),
    publicValue: kind === "public" ? key : null,
    createdAt: now,
  });
  return { key };
}

/** The project a write key belongs to, or null for an unknown, revoked or wrong-kind key. */
export async function authenticateAttributionKey(key: string, kind: KeyKind) {
  if (!key.startsWith(PREFIX[kind])) return null;
  const row = await ledger.findKey(await sha256Hex(key));
  if (!row || row.kind !== kind) return null;
  const now = new Date();
  if (
    !row.lastUsedAt ||
    now.getTime() - Date.parse(row.lastUsedAt) > LAST_USED_REFRESH_MS
  )
    await ledger.touchKey(row.id, now.toISOString());
  return { projectId: row.projectId, keyId: row.id };
}

/** The project's public key, which can be shown again, or null before one exists. */
export async function getPublicKey(projectId: string) {
  return (await ledger.getPublicKey(projectId)) ?? null;
}

/** Which keys exist and when they last sent anything. Never the keys. */
export const listAttributionKeys = (projectId: string) =>
  ledger.listKeys(projectId);
