import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { competitorDismissals, projects } from "@/db/schema";
import type { DismissalKind } from "@/shared/competitor-dismissal";

async function list(projectId: string) {
  return db
    .select({
      domain: competitorDismissals.domain,
      kind: competitorDismissals.kind,
      createdAt: competitorDismissals.createdAt,
    })
    .from(competitorDismissals)
    .where(eq(competitorDismissals.projectId, projectId))
    .orderBy(asc(competitorDismissals.domain));
}

async function upsert(projectId: string, domain: string, kind: DismissalKind) {
  await db
    .insert(competitorDismissals)
    .values({ projectId, domain, kind })
    .onConflictDoUpdate({
      target: [competitorDismissals.projectId, competitorDismissals.domain],
      set: { kind },
    });
}

async function remove(projectId: string, domain: string) {
  await db
    .delete(competitorDismissals)
    .where(
      and(
        eq(competitorDismissals.projectId, projectId),
        eq(competitorDismissals.domain, domain),
      ),
    );
}

/**
 * What the same organization's other projects ruled these domains out as, so a
 * directory dismissed once can be offered in the next project. Scoped by
 * organization: one workspace's choices never reach another's.
 */
async function listFromOtherProjects(
  organizationId: string,
  projectId: string,
  domains: string[],
) {
  if (domains.length === 0) return [];
  return db
    .select({
      domain: competitorDismissals.domain,
      kind: competitorDismissals.kind,
    })
    .from(competitorDismissals)
    .innerJoin(projects, eq(projects.id, competitorDismissals.projectId))
    .where(
      and(
        eq(projects.organizationId, organizationId),
        ne(competitorDismissals.projectId, projectId),
        inArray(competitorDismissals.domain, domains),
      ),
    );
}

export const CompetitorDismissalRepository = {
  list,
  upsert,
  remove,
  listFromOtherProjects,
};
