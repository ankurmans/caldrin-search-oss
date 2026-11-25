import {
  LedgerNamesRepository,
  type MemberNameRow,
} from "../repositories/LedgerNamesRepository";
import type { LedgerEntry, LedgerEntryWithNames } from "../types";

const UNKNOWN_USER = "Unknown user";

function displayName(row: MemberNameRow | undefined): string {
  const name = row?.name.trim();
  if (name) return name;
  const localPart = row?.email.split("@")[0]?.trim();
  return localPart || UNKNOWN_USER;
}

// Adds a display name beside each user id on the entries. Lookups are limited
// to members of the entry's own organization, so a user id from another
// tenant (or a former member) shows as "Unknown user" instead of a stranger.
export async function withPeopleNames(
  entries: LedgerEntry[],
): Promise<LedgerEntryWithNames[]> {
  const userIds = new Set<string>();
  for (const entry of entries) {
    for (const id of [
      entry.requestedByUserId,
      entry.approvedByUserId,
      entry.executedByUserId,
      entry.rolledBackByUserId,
      entry.finalDecidedByUserId,
    ]) {
      if (id) userIds.add(id);
    }
  }
  const rows = await LedgerNamesRepository.listMemberNames(
    [...new Set(entries.map((entry) => entry.organizationId))],
    [...userIds],
  );
  const byKey = new Map(
    rows.map((row) => [`${row.organizationId}:${row.userId}`, row]),
  );
  return entries.map((entry) => {
    const nameOf = (userId: string | null) =>
      userId
        ? displayName(byKey.get(`${entry.organizationId}:${userId}`))
        : null;
    return {
      ...entry,
      proposedByName: nameOf(entry.requestedByUserId) ?? UNKNOWN_USER,
      approvedByName: nameOf(entry.approvedByUserId),
      executedByName: nameOf(entry.executedByUserId),
      rolledBackByName: nameOf(entry.rolledBackByUserId),
      finalDecidedByName: nameOf(entry.finalDecidedByUserId),
    };
  });
}
