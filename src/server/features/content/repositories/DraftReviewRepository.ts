import { and, eq, asc, ne } from "drizzle-orm";
import { db } from "@/db";
import { contentAssets, member, projectAccess, user } from "@/db/schema";
import { roleSeesAllProjects } from "@/lib/org-permissions";

export async function listProjectReviewers(
  projectId: string,
  organizationId: string,
) {
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      role: member.role,
      granted: projectAccess.projectId,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .leftJoin(
      projectAccess,
      and(
        eq(projectAccess.userId, member.userId),
        eq(projectAccess.organizationId, organizationId),
        eq(projectAccess.projectId, projectId),
      ),
    )
    .where(eq(member.organizationId, organizationId))
    .orderBy(asc(user.name), asc(user.id));
  return rows
    .filter((row) => row.granted || roleSeesAllProjects(row.role))
    .map(({ id, name }) => ({ id, name }));
}

export async function updateDraftReviewer(
  projectId: string,
  assetId: string,
  reviewerUserId: string | null,
) {
  const [updated] = await db
    .update(contentAssets)
    .set({ reviewerUserId })
    .where(
      and(
        eq(contentAssets.projectId, projectId),
        eq(contentAssets.id, assetId),
        ne(contentAssets.status, "published"),
      ),
    )
    .returning({ id: contentAssets.id });
  return Boolean(updated);
}
