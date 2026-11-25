import { and, asc, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { projects, samSessions } from "@/db/schema";
import type { SiteHost } from "@/shared/site-host";
import type { SitePlatform } from "@/shared/site-platform";
import { AppError } from "@/server/lib/errors";

async function listProjects(organizationId: string) {
  return db.query.projects.findMany({
    where: and(
      eq(projects.organizationId, organizationId),
      isNull(projects.archivedAt),
    ),
    orderBy: [
      asc(projects.sortOrder),
      desc(projects.createdAt),
      desc(projects.id),
    ],
  });
}

async function organizeProjects(
  organizationId: string,
  items: Array<{
    id: string;
    sortOrder: number;
    starred: boolean;
    groupName: string | null;
  }>,
) {
  for (const item of items) {
    await db
      .update(projects)
      .set({
        sortOrder: item.sortOrder,
        starred: item.starred,
        groupName: item.groupName,
      })
      .where(
        and(
          eq(projects.id, item.id),
          eq(projects.organizationId, organizationId),
          isNull(projects.archivedAt),
        ),
      );
  }
}

async function countProjects(organizationId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, organizationId),
        isNull(projects.archivedAt),
      ),
    );
  return row?.value ?? 0;
}

async function getProjectForOrganization(
  projectId: string,
  organizationId: string,
) {
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
        isNull(projects.archivedAt),
      ),
    )
    .limit(1);
  return project ?? null;
}

// The archived counterpart of getProjectForOrganization, for the surfaces that
// owe the reader "this project is archived" instead of a bare not-found. Still
// org-scoped, so it adds no cross-org existence oracle.
async function getArchivedProjectForOrganization(
  projectId: string,
  organizationId: string,
) {
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
        isNotNull(projects.archivedAt),
      ),
    )
    .limit(1);
  return project ?? null;
}

// Look up a project by id alone (no org scoping). Only for trusted server
// contexts that have already authorized access another way — e.g. the
// SAM chat Durable Object, whose connections are authorized in the Worker
// before they reach the DO, and which derives its org from the project.
async function getProjectById(projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.archivedAt)))
    .limit(1);
  return project ?? null;
}

async function createProject(
  organizationId: string,
  name: string,
  domain?: string,
  // Omitted keeps the column defaults.
  market?: { locationCode: number; languageCode: string },
) {
  const id = crypto.randomUUID();
  const [row] = await db
    .insert(projects)
    .values({ id, organizationId, name, domain, ...market })
    .returning();
  return row;
}

// The old domain is evaluated by the update itself, so concurrent settings
// saves cannot carry a platform override over to a different website.
function keepSitePlatformForDomain(domain: string | null) {
  return {
    siteHost: sql`case when ${projects.domain} = ${domain} then ${projects.siteHost} end`,
    detectedPlatform: sql`case when ${projects.domain} = ${domain} then ${projects.detectedPlatform} end`,
    platformEvidence: sql`case when ${projects.domain} = ${domain} then ${projects.platformEvidence} end`,
    platformOverride: sql`case when ${projects.domain} = ${domain} then ${projects.platformOverride} end`,
  };
}

async function updateProject(
  projectId: string,
  organizationId: string,
  input: {
    name: string;
    // Omitted leaves the brand name untouched.
    brandName?: string;
    domain?: string;
    // Omitted leaves the market columns untouched.
    market?: { locationCode: number; languageCode: string };
  },
) {
  const [row] = await db
    .update(projects)
    .set({
      name: input.name,
      brandName: input.brandName,
      domain: input.domain ?? null,
      ...keepSitePlatformForDomain(input.domain ?? null),
      ...input.market,
    })
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
        isNull(projects.archivedAt),
      ),
    )
    .returning();

  if (!row) {
    throw new AppError("NOT_FOUND");
  }

  return row;
}

// Save website setup atomically without rewriting the project name.
async function updateProjectWebsite(
  projectId: string,
  organizationId: string,
  domain: string,
  market: { locationCode: number; languageCode: string },
) {
  const [row] = await db
    .update(projects)
    .set({ domain, ...market, ...keepSitePlatformForDomain(domain) })
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
        isNull(projects.archivedAt),
      ),
    )
    .returning();

  if (!row) {
    throw new AppError("NOT_FOUND");
  }

  return row;
}

async function updateSitePlatform(
  projectId: string,
  organizationId: string,
  domain: string,
  fields:
    | {
        siteHost: SiteHost;
        detectedPlatform: SitePlatform;
        platformEvidence: string | null;
      }
    | { platformOverride: SitePlatform | null },
) {
  const [row] = await db
    .update(projects)
    .set(fields)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
        eq(projects.domain, domain),
        isNull(projects.archivedAt),
      ),
    )
    .returning({
      siteHost: projects.siteHost,
      detectedPlatform: projects.detectedPlatform,
      platformEvidence: projects.platformEvidence,
      platformOverride: projects.platformOverride,
    });
  if (!row)
    throw new AppError(
      "CONFLICT",
      "The project website changed. Reload and try again.",
    );
  return row;
}

// Saves the key only if the project has none, so concurrent first uses can't
// leave the site's key file pointing at a key that was overwritten.
async function setIndexNowKeyIfMissing(
  projectId: string,
  organizationId: string,
  key: string,
) {
  await db
    .update(projects)
    .set({ indexnowKey: key })
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
        isNull(projects.indexnowKey),
      ),
    );
}

async function tryCreateDefaultProject(organizationId: string) {
  const id = crypto.randomUUID();
  const inserted = await db
    .insert(projects)
    .values({
      id,
      organizationId,
      name: "Default",
      domain: null,
    })
    .onConflictDoNothing()
    .returning({ id: projects.id });
  return inserted.length > 0 ? id : null;
}

async function listArchivedProjects(organizationId: string) {
  return db.query.projects.findMany({
    where: and(
      eq(projects.organizationId, organizationId),
      isNotNull(projects.archivedAt),
    ),
    orderBy: [desc(projects.archivedAt), desc(projects.id)],
  });
}

async function restoreProject(projectId: string, organizationId: string) {
  const [row] = await db
    .update(projects)
    .set({ archivedAt: null })
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
        isNotNull(projects.archivedAt),
      ),
    )
    .returning({ id: projects.id });

  if (!row) {
    throw new AppError("NOT_FOUND");
  }
}

async function archiveProject(projectId: string, organizationId: string) {
  const [row] = await db
    .update(projects)
    .set({ archivedAt: sql`(current_timestamp)` })
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
        isNull(projects.archivedAt),
      ),
    )
    .returning({ id: projects.id });

  if (!row) {
    throw new AppError("NOT_FOUND");
  }
}

// Permanently deletes an archived project; its database rows cascade. Returns
// the ids of its chat sessions, whose transcripts live in Durable Objects the
// cascade can't reach, or null when no such archived project exists.
async function deleteArchivedProject(
  projectId: string,
  organizationId: string,
) {
  const sessions = await db
    .select({ id: samSessions.id })
    .from(samSessions)
    .where(eq(samSessions.projectId, projectId));
  const [row] = await db
    .delete(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
        isNotNull(projects.archivedAt),
      ),
    )
    .returning({ id: projects.id });
  return row ? sessions.map((session) => session.id) : null;
}

export const ProjectRepository = {
  listProjects,
  organizeProjects,
  listArchivedProjects,
  countProjects,
  getProjectForOrganization,
  getArchivedProjectForOrganization,
  getProjectById,
  createProject,
  updateProject,
  updateProjectWebsite,
  updateSitePlatform,
  setIndexNowKeyIfMissing,
  tryCreateDefaultProject,
  archiveProject,
  restoreProject,
  deleteArchivedProject,
} as const;
