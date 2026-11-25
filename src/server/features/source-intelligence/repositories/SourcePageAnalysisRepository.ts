import { and, asc, eq } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { sourcePageAnalyses, sourcePageAnalysisItems } from "@/db/schema";

export type AnalysisItemKind =
  | "buyer_question"
  | "competitor_named"
  | "dated_fact";

type AnalysisRow = typeof sourcePageAnalyses.$inferSelect;
export type StoredAnalysis = AnalysisRow & {
  items: { kind: AnalysisItemKind; text: string }[];
};

async function get(
  projectId: string,
  url: string,
): Promise<StoredAnalysis | null> {
  const [row] = await db
    .select()
    .from(sourcePageAnalyses)
    .where(
      and(
        eq(sourcePageAnalyses.projectId, projectId),
        eq(sourcePageAnalyses.url, url),
      ),
    )
    .limit(1);
  if (!row) return null;
  const items = await db
    .select({
      kind: sourcePageAnalysisItems.kind,
      text: sourcePageAnalysisItems.text,
    })
    .from(sourcePageAnalysisItems)
    .where(eq(sourcePageAnalysisItems.analysisId, row.id))
    .orderBy(
      asc(sourcePageAnalysisItems.kind),
      asc(sourcePageAnalysisItems.position),
    );
  return { ...row, items };
}

/** Replaces the project's reading of this page, items included. */
async function replace(
  analysis: typeof sourcePageAnalyses.$inferInsert,
  items: { kind: AnalysisItemKind; text: string }[],
) {
  await runBatch((tx) => [
    tx
      .delete(sourcePageAnalyses)
      .where(
        and(
          eq(sourcePageAnalyses.projectId, analysis.projectId),
          eq(sourcePageAnalyses.url, analysis.url),
        ),
      ),
    tx.insert(sourcePageAnalyses).values(analysis),
    // Five columns per item: D1 allows 100 bound parameters per statement.
    ...chunk(
      items.map((item, position) => ({
        id: crypto.randomUUID(),
        analysisId: analysis.id,
        kind: item.kind,
        text: item.text,
        position,
      })),
      15,
    ).map((rows) => tx.insert(sourcePageAnalysisItems).values(rows)),
  ]);
}

export const SourcePageAnalysisRepository = { get, replace };
