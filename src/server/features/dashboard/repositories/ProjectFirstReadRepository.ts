import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { isUniqueViolation } from "@/db/isUniqueViolation";
import { runBatch } from "@/db/runBatch";
import { projectFirstReads, projectFirstReadFindings } from "@/db/schema";

type Read = typeof projectFirstReads.$inferInsert;
type Finding = Omit<
  typeof projectFirstReadFindings.$inferInsert,
  "readKey" | "rank"
>;

async function get(key: string) {
  const [read] = await db
    .select()
    .from(projectFirstReads)
    .where(eq(projectFirstReads.key, key));
  if (!read) return null;
  const findings = await db
    .select()
    .from(projectFirstReadFindings)
    .where(eq(projectFirstReadFindings.readKey, key))
    .orderBy(asc(projectFirstReadFindings.rank));
  return {
    completedAt: read.completedAt,
    searchConsole: read.searchConsole,
    findings,
  };
}

async function save(read: Read, findings: Finding[]) {
  try {
    await runBatch((tx) => [
      tx.insert(projectFirstReads).values(read),
      ...(findings.length
        ? [
            tx.insert(projectFirstReadFindings).values(
              findings.map((finding, rank) => ({
                ...finding,
                readKey: read.key,
                rank,
              })),
            ),
          ]
        : []),
    ]);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  return get(read.key);
}

export const ProjectFirstReadRepository = { get, save };
