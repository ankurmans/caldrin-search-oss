import { and, eq, inArray } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import {
  attributionIdentityLinks,
  attributionIdentityNodes,
} from "@/db/schema";

export type NodeRow = typeof attributionIdentityNodes.$inferSelect;
type LinkRow = typeof attributionIdentityLinks.$inferSelect;
export type NodeKey = { type: string; value: string };

const IN_CHUNK = 90;

/** The nodes for these identities; types are matched after, since values rarely collide. */
async function findNodes(projectId: string, keys: NodeKey[]) {
  const wanted = new Set(keys.map((k) => `${k.type}\u0000${k.value}`));
  const found: NodeRow[] = [];
  for (const part of chunk([...new Set(keys.map((k) => k.value))], IN_CHUNK)) {
    const rows = await db
      .select()
      .from(attributionIdentityNodes)
      .where(
        and(
          eq(attributionIdentityNodes.projectId, projectId),
          inArray(attributionIdentityNodes.nodeValue, part),
        ),
      );
    found.push(
      ...rows.filter((r) => wanted.has(`${r.nodeType}\u0000${r.nodeValue}`)),
    );
  }
  return found;
}

const insertNodes = async (
  rows: (typeof attributionIdentityNodes.$inferInsert)[],
) => {
  for (const part of chunk(rows, 15))
    await db
      .insert(attributionIdentityNodes)
      .values(part)
      .onConflictDoNothing();
};

const nodesOfSubjects = async (projectId: string, subjectIds: string[]) => {
  const rows: NodeRow[] = [];
  for (const part of chunk(subjectIds, IN_CHUNK))
    rows.push(
      ...(await db
        .select()
        .from(attributionIdentityNodes)
        .where(
          and(
            eq(attributionIdentityNodes.projectId, projectId),
            inArray(attributionIdentityNodes.subjectId, part),
          ),
        )
        .limit(500)),
    );
  return rows;
};

const reassignSubject = (projectId: string, from: string, to: string) =>
  db
    .update(attributionIdentityNodes)
    .set({ subjectId: to })
    .where(
      and(
        eq(attributionIdentityNodes.projectId, projectId),
        eq(attributionIdentityNodes.subjectId, from),
      ),
    );

const insertLink = (row: typeof attributionIdentityLinks.$inferInsert) =>
  db.insert(attributionIdentityLinks).values(row).onConflictDoNothing();

/** Every link, accepted or refused, that touches one of these identities. */
async function linksTouching(projectId: string, keys: NodeKey[]) {
  const values = [...new Set(keys.map((k) => k.value))];
  const wanted = new Set(keys.map((k) => `${k.type}\u0000${k.value}`));
  const rows: LinkRow[] = [];
  for (const part of chunk(values, IN_CHUNK)) {
    for (const side of ["a", "b"] as const) {
      const column =
        side === "a"
          ? attributionIdentityLinks.aValue
          : attributionIdentityLinks.bValue;
      rows.push(
        ...(await db
          .select()
          .from(attributionIdentityLinks)
          .where(
            and(
              eq(attributionIdentityLinks.projectId, projectId),
              inArray(column, part),
            ),
          )),
      );
    }
  }
  const unique = new Map(rows.map((r) => [r.id, r]));
  return [...unique.values()].filter(
    (r) =>
      wanted.has(`${r.aType}\u0000${r.aValue}`) ||
      wanted.has(`${r.bType}\u0000${r.bValue}`),
  );
}

const wipe = async (projectId: string) => {
  await db
    .delete(attributionIdentityLinks)
    .where(eq(attributionIdentityLinks.projectId, projectId));
  await db
    .delete(attributionIdentityNodes)
    .where(eq(attributionIdentityNodes.projectId, projectId));
};

export const AttributionIdentityRepository = {
  findNodes,
  insertNodes,
  nodesOfSubjects,
  reassignSubject,
  insertLink,
  linksTouching,
  wipe,
};
