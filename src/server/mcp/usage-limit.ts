import { env } from "cloudflare:workers";
import { and, eq, like, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { mcpUsage } from "@/db/schema";
import { getAuthMode } from "@/lib/auth-mode";
import { getWorkspaceMode } from "@/server/features/workspace/credentials";
import { AppError } from "@/server/lib/errors";
import { getEnvValueSync } from "@/server/lib/runtime-env";

// A deployment with the MCP_RATE_LIMIT binding throttles by user there.
// Everywhere else these counters stand in: a per-workspace request ceiling,
// and a daily cap for workspaces that run on the deployment's keys, since
// that money is the operator's.
//
// These are the defaults. An operator can override them with the worker env
// vars MCP_CALLS_PER_MINUTE and MCP_CLOUD_CALLS_PER_DAY.
export const MCP_CALLS_PER_MINUTE = 600;
export const MCP_CLOUD_CALLS_PER_DAY = 2000;

// Only a plain positive whole number counts. Anything else (empty, "0", "-5",
// "1e3", "10 calls", a value past the safe integer range) keeps the default, so
// a typo cannot switch the limit off or lock every workspace out.
function limitFromEnv(name: string, fallback: number): number {
  const raw = getEnvValueSync(env, name)?.trim();
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

async function bump(organizationId: string, bucket: string): Promise<number> {
  const [row] = await db
    .insert(mcpUsage)
    .values({ organizationId, bucket, count: 1 })
    .onConflictDoUpdate({
      target: [mcpUsage.organizationId, mcpUsage.bucket],
      set: { count: sql`${mcpUsage.count} + 1` },
    })
    .returning({ count: mcpUsage.count });
  return row?.count ?? 1;
}

async function dropOlder(
  organizationId: string,
  prefix: string,
  bucket: string,
) {
  await db
    .delete(mcpUsage)
    .where(
      and(
        eq(mcpUsage.organizationId, organizationId),
        like(mcpUsage.bucket, `${prefix}%`),
        lt(mcpUsage.bucket, bucket),
      ),
    );
}

export async function enforceMcpUsage(organizationId: string): Promise<void> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the binding is declared in deploy/alchemy/alchemy.run.ts and absent in local dev
  if ((env as { MCP_RATE_LIMIT?: unknown }).MCP_RATE_LIMIT) return;

  const callsPerMinute = limitFromEnv(
    "MCP_CALLS_PER_MINUTE",
    MCP_CALLS_PER_MINUTE,
  );
  const now = new Date().toISOString();
  const minute = `m:${now.slice(0, 16)}`;
  const calls = await bump(organizationId, minute);
  if (calls === 1) await dropOlder(organizationId, "m:", minute);
  if (calls > callsPerMinute) {
    throw new AppError(
      "RATE_LIMITED",
      `Rate limit exceeded: ${callsPerMinute} requests per minute per workspace. Try again in a minute.`,
    );
  }

  // Single-user modes always run on the deployment's keys by design.
  if (getAuthMode(env.AUTH_MODE) !== "password") return;
  if ((await getWorkspaceMode(organizationId)) !== "cloud") return;
  const callsPerDay = limitFromEnv(
    "MCP_CLOUD_CALLS_PER_DAY",
    MCP_CLOUD_CALLS_PER_DAY,
  );
  const day = `d:${now.slice(0, 10)}`;
  const today = await bump(organizationId, day);
  if (today === 1) await dropOlder(organizationId, "d:", day);
  if (today > callsPerDay) {
    throw new AppError(
      "RATE_LIMITED",
      `This workspace used its ${callsPerDay} included calls for today. Add your own keys in Settings to keep going.`,
    );
  }
}
