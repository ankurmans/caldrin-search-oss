import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { invitationProjectAccess, projectAccess, projects } from "@/db/schema";
import { isClientGuest, roleSeesAllProjects } from "@/lib/org-permissions";

import { getPlatformAccess } from "@/server/features/billing/platformAccess";

// null = every project in the organization. Anything else is the exact list a
// scoped member may open (empty when nothing was granted).
export async function getAllowedProjectIds(
  userId: string,
  organizationId: string,
  role: string,
): Promise<string[] | null> {
  if (isClientGuest(role)) {
    if (!(await getPlatformAccess(organizationId)).canInviteGuests) return [];
  } else if (roleSeesAllProjects(role)) {
    return null;
  }
  const rows = await db
    .select({ projectId: projectAccess.projectId })
    .from(projectAccess)
    .where(
      and(
        eq(projectAccess.userId, userId),
        eq(projectAccess.organizationId, organizationId),
      ),
    );
  return rows.map((row) => row.projectId);
}

// Only ids that are live projects of this organization are stored, so a
// crafted request cannot grant access to another workspace's project.
async function filterOrganizationProjectIds(
  organizationId: string,
  projectIds: string[],
) {
  if (projectIds.length === 0) return [];
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.organizationId, organizationId),
        isNull(projects.archivedAt),
        inArray(projects.id, projectIds),
      ),
    );
  return rows.map((row) => row.id);
}

export async function setMemberProjects(
  organizationId: string,
  userId: string,
  projectIds: string[],
) {
  const valid = await filterOrganizationProjectIds(organizationId, projectIds);
  await db
    .delete(projectAccess)
    .where(
      and(
        eq(projectAccess.userId, userId),
        eq(projectAccess.organizationId, organizationId),
      ),
    );
  if (valid.length === 0) return;
  await db
    .insert(projectAccess)
    .values(valid.map((projectId) => ({ organizationId, userId, projectId })));
}

export async function listProjectAccessForOrganization(organizationId: string) {
  return db
    .select({
      userId: projectAccess.userId,
      projectId: projectAccess.projectId,
    })
    .from(projectAccess)
    .where(eq(projectAccess.organizationId, organizationId));
}

export async function setInvitationProjects(
  organizationId: string,
  invitationId: string,
  projectIds: string[],
) {
  const valid = await filterOrganizationProjectIds(organizationId, projectIds);
  await db
    .delete(invitationProjectAccess)
    .where(eq(invitationProjectAccess.invitationId, invitationId));
  if (valid.length === 0) return;
  await db
    .insert(invitationProjectAccess)
    .values(valid.map((projectId) => ({ invitationId, projectId })));
}

export async function listInvitationProjects(invitationIds: string[]) {
  if (invitationIds.length === 0) return [];
  return db
    .select()
    .from(invitationProjectAccess)
    .where(inArray(invitationProjectAccess.invitationId, invitationIds));
}

// On accept: the picks made at invite time become the member's access.
export async function applyInvitationProjects(
  invitationId: string,
  organizationId: string,
  userId: string,
) {
  const rows = await listInvitationProjects([invitationId]);
  await setMemberProjects(
    organizationId,
    userId,
    rows.map((row) => row.projectId),
  );
  await db
    .delete(invitationProjectAccess)
    .where(eq(invitationProjectAccess.invitationId, invitationId));
}
