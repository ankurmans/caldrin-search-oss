import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { chunk } from "remeda";
import type { LinkActor } from "@/shared/link-acquisition";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { linkPlacementChecks, linkPlacements, projects } from "@/db/schema";

export type PlacementRecord = typeof linkPlacements.$inferSelect;
export type PlacementCheckRecord = typeof linkPlacementChecks.$inferSelect;
export type PlacementState = PlacementRecord["state"];
export type NewCheck = Omit<PlacementCheckRecord, "id" | "placementId">;

const ID_CHUNK = 90;

/** Inserts a placement, or returns the one already recorded for the same link. */
async function insert(input: {
  projectId: string;
  prospectId: string | null;
  campaignMode: PlacementRecord["campaignMode"];
  urlFrom: string;
  expectedTarget: string;
  state: PlacementState;
  costUsd: number | null;
  actor: LinkActor;
}) {
  const [row] = await db
    .insert(linkPlacements)
    .values({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      prospectId: input.prospectId,
      campaignMode: input.campaignMode,
      urlFrom: input.urlFrom,
      expectedTarget: input.expectedTarget,
      state: input.state,
      costUsd: input.costUsd,
      createdBy: input.actor,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return { placement: row, created: true };
  const [existing] = await db
    .select()
    .from(linkPlacements)
    .where(
      and(
        eq(linkPlacements.projectId, input.projectId),
        eq(linkPlacements.urlFrom, input.urlFrom),
        eq(linkPlacements.expectedTarget, input.expectedTarget),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Failed to create link_placement");
  return { placement: existing, created: false };
}

async function get(projectId: string, id: string) {
  const [row] = await db
    .select()
    .from(linkPlacements)
    .where(
      and(eq(linkPlacements.projectId, projectId), eq(linkPlacements.id, id)),
    )
    .limit(1);
  return row ?? null;
}

async function list(projectId: string, state?: PlacementState) {
  return db
    .select()
    .from(linkPlacements)
    .where(
      and(
        eq(linkPlacements.projectId, projectId),
        state ? eq(linkPlacements.state, state) : undefined,
      ),
    )
    .orderBy(desc(linkPlacements.createdAt))
    .limit(500);
}

async function checksOf(placementIds: string[], perPlacement = 10) {
  if (placementIds.length === 0) return [];
  const rows = await Promise.all(
    chunk(placementIds, ID_CHUNK).map((part) =>
      db
        .select()
        .from(linkPlacementChecks)
        .where(inArray(linkPlacementChecks.placementId, part))
        .orderBy(desc(linkPlacementChecks.checkedAt)),
    ),
  );
  const seen = new Map<string, number>();
  return rows.flat().filter((check) => {
    const n = seen.get(check.placementId) ?? 0;
    seen.set(check.placementId, n + 1);
    return n < perPlacement;
  });
}

/** One batch: the check row and the placement's new state. */
async function recordCheck(input: {
  projectId: string;
  placement: PlacementRecord;
  check: NewCheck;
  state: PlacementState;
}) {
  const { placement, check } = input;
  const first =
    input.state === "confirmed_live" && !placement.firstVerifiedAt
      ? check.checkedAt
      : placement.firstVerifiedAt;
  await runBatch((tx) => [
    tx.insert(linkPlacementChecks).values({
      id: crypto.randomUUID(),
      placementId: placement.id,
      ...check,
    }),
    tx
      .update(linkPlacements)
      .set({
        state: input.state,
        firstVerifiedAt: first,
        lastVerifiedAt:
          input.state === "confirmed_live"
            ? check.checkedAt
            : placement.lastVerifiedAt,
        lastCheckedAt: check.checkedAt,
      })
      .where(
        and(
          eq(linkPlacements.projectId, input.projectId),
          eq(linkPlacements.id, placement.id),
        ),
      ),
  ]);
}

async function organizationOf(projectId: string) {
  const [row] = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return row?.organizationId ?? null;
}

/** Placements whose last check is older than `before`, across projects. */
async function due(before: string, limit: number) {
  return (
    db
      .select({
        placement: linkPlacements,
        organizationId: projects.organizationId,
      })
      .from(linkPlacements)
      .innerJoin(projects, eq(projects.id, linkPlacements.projectId))
      .where(
        and(
          inArray(linkPlacements.state, [
            "promised",
            "observed",
            "confirmed_live",
            "no_longer_verifiable",
          ]),
          or(
            isNull(linkPlacements.lastCheckedAt),
            lt(linkPlacements.lastCheckedAt, before),
          ),
        ),
      )
      // Every project's oldest placement comes before any project's second, so
      // one large or skipped backlog cannot take the whole run.
      .orderBy(
        sql`row_number() over (partition by ${linkPlacements.projectId} order by ${linkPlacements.lastCheckedAt} asc nulls first)`,
        sql`${linkPlacements.lastCheckedAt} asc nulls first`,
      )
      .limit(limit)
  );
}

async function stateCounts(projectId: string) {
  const rows = await db
    .select({
      state: linkPlacements.state,
      mode: linkPlacements.campaignMode,
      total: count(),
    })
    .from(linkPlacements)
    .where(eq(linkPlacements.projectId, projectId))
    .groupBy(linkPlacements.state, linkPlacements.campaignMode);
  return rows;
}

async function costTotals(projectId: string) {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${linkPlacements.costUsd}), 0)` })
    .from(linkPlacements)
    .where(eq(linkPlacements.projectId, projectId));
  return Number(row?.total ?? 0);
}

async function updateCost(
  projectId: string,
  id: string,
  costUsd: number | null,
) {
  await db
    .update(linkPlacements)
    .set({ costUsd })
    .where(
      and(eq(linkPlacements.projectId, projectId), eq(linkPlacements.id, id)),
    );
}

export const LinkPlacementRepository = {
  insert,
  get,
  list,
  checksOf,
  recordCheck,
  due,
  organizationOf,
  stateCounts,
  costTotals,
  updateCost,
};
