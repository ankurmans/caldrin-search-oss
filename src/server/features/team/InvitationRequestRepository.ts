import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { projectInvitationRequest as requests } from "@/db/schema";

async function list(organizationId: string, requesterId?: string) {
  return db
    .select()
    .from(requests)
    .where(
      and(
        eq(requests.organizationId, organizationId),
        requesterId
          ? eq(requests.requesterId, requesterId)
          : inArray(requests.status, ["pending", "processing"]),
      ),
    )
    .orderBy(desc(requests.createdAt))
    .limit(100);
}

async function request(input: typeof requests.$inferInsert) {
  const [row] = await db
    .insert(requests)
    .values(input)
    .onConflictDoUpdate({
      target: [requests.organizationId, requests.projectId, requests.email],
      set: {
        status: "pending",
        requesterId: input.requesterId,
        createdAt: input.createdAt,
        reviewedAt: null,
      },
      setWhere: eq(requests.status, "declined"),
    })
    .returning({ id: requests.id });
  return row;
}

async function pendingCount(organizationId: string, requesterId: string) {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
    .from(requests)
    .where(
      and(
        eq(requests.organizationId, organizationId),
        eq(requests.requesterId, requesterId),
        inArray(requests.status, ["pending", "processing"]),
      ),
    );
  return row?.count ?? 0;
}

async function claim(
  organizationId: string,
  id: string,
  at: string,
  staleBefore: string,
) {
  const [row] = await db
    .update(requests)
    .set({ status: "processing", reviewedAt: at })
    .where(
      and(
        eq(requests.organizationId, organizationId),
        eq(requests.id, id),
        or(
          eq(requests.status, "pending"),
          and(
            eq(requests.status, "processing"),
            lt(requests.reviewedAt, staleBefore),
          ),
        ),
      ),
    )
    .returning();
  return row;
}

async function review(
  organizationId: string,
  id: string,
  claimAt: string,
  status: "pending" | "declined" | "approved",
) {
  await db
    .update(requests)
    .set({ status, reviewedAt: status === "pending" ? null : claimAt })
    .where(
      and(
        eq(requests.organizationId, organizationId),
        eq(requests.id, id),
        eq(requests.status, "processing"),
        eq(requests.reviewedAt, claimAt),
      ),
    );
}

export const InvitationRequestRepository = {
  list,
  request,
  pendingCount,
  claim,
  review,
};
