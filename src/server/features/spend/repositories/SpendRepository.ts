import { and, desc, eq, gte, like, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  changeLedgerEntries,
  projectSpendLimits,
  providerCosts,
  workspaceSettings,
} from "@/db/schema";
import type { SpendLimits } from "../types";

// Every query is scoped by projectId. Callers pass the projectId that
// requireProjectContext resolved from the session, never one taken from input.

async function getLimits(projectId: string): Promise<SpendLimits | null> {
  const [row] = await db
    .select({
      dailyUsd: projectSpendLimits.dailyUsd,
      monthlyUsd: projectSpendLimits.monthlyUsd,
      scheduledJobsPerDay: projectSpendLimits.scheduledJobsPerDay,
    })
    .from(projectSpendLimits)
    .where(eq(projectSpendLimits.projectId, projectId))
    .limit(1);
  return row ?? null;
}

async function upsertLimits(
  projectId: string,
  userId: string,
  limits: SpendLimits,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(projectSpendLimits)
    .values({ projectId, updatedByUserId: userId, updatedAt: now, ...limits })
    .onConflictDoUpdate({
      target: projectSpendLimits.projectId,
      set: { updatedByUserId: userId, updatedAt: now, ...limits },
    });
}

async function sumSince(projectId: string, since: string): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${providerCosts.costUsd}), 0)`,
    })
    .from(providerCosts)
    .where(
      and(
        eq(providerCosts.projectId, projectId),
        gte(providerCosts.createdAt, since),
      ),
    );
  return Number(row?.total ?? 0);
}

async function getPlanKey(organizationId: string): Promise<string | null> {
  const [row] = await db
    .select({ plan: workspaceSettings.plan })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.organizationId, organizationId))
    .limit(1);
  return row?.plan ?? null;
}

async function sumOrganizationSince(
  organizationId: string,
  since: string,
): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${providerCosts.costUsd}), 0)`,
    })
    .from(providerCosts)
    .where(
      and(
        eq(providerCosts.organizationId, organizationId),
        gte(providerCosts.createdAt, since),
      ),
    );
  return Number(row?.total ?? 0);
}

async function sumByProviderSince(projectId: string, since: string) {
  const rows = await db
    .select({
      provider: providerCosts.provider,
      total: sql<number>`coalesce(sum(${providerCosts.costUsd}), 0)`,
    })
    .from(providerCosts)
    .where(
      and(
        eq(providerCosts.projectId, projectId),
        gte(providerCosts.createdAt, since),
      ),
    )
    .groupBy(providerCosts.provider);
  return new Map(rows.map((row) => [row.provider, Number(row.total)]));
}

async function countOperationPrefixSince(
  projectId: string,
  prefix: string,
  since: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(providerCosts)
    .where(
      and(
        eq(providerCosts.projectId, projectId),
        like(providerCosts.operation, `${prefix}%`),
        gte(providerCosts.createdAt, since),
      ),
    );
  return Number(row?.n ?? 0);
}

async function latestOperationSince(
  projectId: string,
  operation: string,
  since: string,
): Promise<{ createdAt: string; costUsd: number } | null> {
  const [row] = await db
    .select({
      createdAt: providerCosts.createdAt,
      costUsd: providerCosts.costUsd,
    })
    .from(providerCosts)
    .where(
      and(
        eq(providerCosts.projectId, projectId),
        eq(providerCosts.operation, operation),
        gte(providerCosts.createdAt, since),
      ),
    )
    .orderBy(desc(providerCosts.createdAt))
    .limit(1);
  return row
    ? { createdAt: row.createdAt, costUsd: Number(row.costUsd) }
    : null;
}

async function ledgerEntryInProject(
  projectId: string,
  ledgerEntryId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: changeLedgerEntries.id })
    .from(changeLedgerEntries)
    .where(
      and(
        eq(changeLedgerEntries.projectId, projectId),
        eq(changeLedgerEntries.id, ledgerEntryId),
      ),
    )
    .limit(1);
  return !!row;
}

async function insertCost(input: {
  projectId: string;
  organizationId: string;
  ledgerEntryId: string | null;
  provider: string;
  operation: string;
  estimatedUsd: number | null;
  costUsd: number;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .insert(providerCosts)
    .values({ id, createdAt: new Date().toISOString(), ...input });
  return id;
}

export const SpendRepository = {
  getLimits,
  upsertLimits,
  sumSince,
  getPlanKey,
  sumOrganizationSince,
  sumByProviderSince,
  countOperationPrefixSince,
  latestOperationSince,
  insertCost,
  ledgerEntryInProject,
};
