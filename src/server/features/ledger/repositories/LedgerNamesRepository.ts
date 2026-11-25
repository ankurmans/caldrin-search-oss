import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { member, user } from "@/db/schema";

export type MemberNameRow = {
  organizationId: string;
  userId: string;
  name: string;
  email: string;
};

// Only people who are members of the given organizations come back, so a
// user id that belongs to another tenant resolves to nothing.
async function listMemberNames(
  organizationIds: string[],
  userIds: string[],
): Promise<MemberNameRow[]> {
  if (organizationIds.length === 0 || userIds.length === 0) return [];
  return db
    .select({
      organizationId: member.organizationId,
      userId: member.userId,
      name: user.name,
      email: user.email,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        inArray(member.organizationId, organizationIds),
        inArray(member.userId, userIds),
      ),
    );
}

export const LedgerNamesRepository = { listMemberNames };
