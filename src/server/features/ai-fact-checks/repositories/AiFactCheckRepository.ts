import { and, asc, eq, inArray } from "drizzle-orm";
import { aiBrandFacts, aiFactChecks } from "@/db/schema";
import { db } from "@/db";

type Fact = typeof aiBrandFacts.$inferSelect;
type Check = typeof aiFactChecks.$inferSelect;

const listFacts = (projectId: string): Promise<Fact[]> =>
  db
    .select()
    .from(aiBrandFacts)
    .where(eq(aiBrandFacts.projectId, projectId))
    .orderBy(asc(aiBrandFacts.createdAt), asc(aiBrandFacts.id));

const insertFact = (row: typeof aiBrandFacts.$inferInsert) =>
  db.insert(aiBrandFacts).values(row);

/** Checks go with the fact, so a removed fact leaves no verdicts behind. */
async function deleteFact(projectId: string, factId: string) {
  const removed = await db
    .delete(aiBrandFacts)
    .where(
      and(eq(aiBrandFacts.projectId, projectId), eq(aiBrandFacts.id, factId)),
    )
    .returning({ id: aiBrandFacts.id });
  return removed.length > 0;
}

async function listChecks(observationIds: string[]): Promise<Check[]> {
  const rows: Check[] = [];
  // Keep every IN list under D1's bind limit.
  for (let offset = 0; offset < observationIds.length; offset += 80)
    rows.push(
      ...(await db
        .select()
        .from(aiFactChecks)
        .where(
          inArray(
            aiFactChecks.observationId,
            observationIds.slice(offset, offset + 80),
          ),
        )),
    );
  return rows;
}

const insertChecks = (rows: (typeof aiFactChecks.$inferInsert)[]) =>
  rows.length
    ? db
        .insert(aiFactChecks)
        .values(rows)
        .onConflictDoNothing({
          target: [aiFactChecks.factId, aiFactChecks.observationId],
        })
    : Promise.resolve();

export const AiFactCheckRepository = {
  listFacts,
  insertFact,
  deleteFact,
  listChecks,
  insertChecks,
};
