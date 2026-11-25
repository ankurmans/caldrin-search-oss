import { AiCrawlerRepository as repo } from "../repositories/AiCrawlerRepository";
import { sha256Hex } from "@/server/lib/audit/ids";

const KEY_PREFIX = "cldr_bot_";

function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `${KEY_PREFIX}${btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")}`;
}

export const hashCrawlerKey = sha256Hex;

/** Creates the project's snippet key, or replaces it. The key is returned once. */
export async function rotateCrawlerKey(projectId: string) {
  const key = newKey();
  await repo.replaceKey({
    id: crypto.randomUUID(),
    projectId,
    keyHash: await sha256Hex(key),
    prefix: key.slice(0, KEY_PREFIX.length + 4),
    createdAt: new Date().toISOString(),
  });
  return { key };
}

/** Whether a snippet key exists and when it last sent a visit. Never the key. */
export async function getCrawlerSetup(projectId: string) {
  const row = await repo.getKey(projectId);
  return row
    ? {
        hasKey: true,
        prefix: row.prefix,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
      }
    : { hasKey: false, prefix: null, createdAt: null, lastUsedAt: null };
}
