import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  aiPrompts,
  aiTrackers,
  auditPages,
  audits,
  sourceGapAnalyses,
  sourceGapOwnerOverrides,
  sourcePageSnapshots,
} from "@/db/schema";

// Every query is scoped by projectId, which callers take from
// requireProjectContext, never from input.

export type StoredSnapshot = typeof sourcePageSnapshots.$inferSelect;
export type StoredAnalysis = typeof sourceGapAnalyses.$inferSelect;

const ID_SLICE = 50;

async function latestSnapshot(
  projectId: string,
  normalizedUrl: string,
): Promise<StoredSnapshot | null> {
  const [row] = await db
    .select()
    .from(sourcePageSnapshots)
    .where(
      and(
        eq(sourcePageSnapshots.projectId, projectId),
        eq(sourcePageSnapshots.normalizedUrl, normalizedUrl),
      ),
    )
    .orderBy(desc(sourcePageSnapshots.fetchedAt))
    .limit(1);
  return row ?? null;
}

async function insertSnapshot(
  row: Omit<StoredSnapshot, "id">,
): Promise<StoredSnapshot> {
  const stored = { id: crypto.randomUUID(), ...row };
  await db.insert(sourcePageSnapshots).values(stored);
  return stored;
}

/** An unchanged page re-read: only the time it was last checked moves. */
async function touchSnapshot(
  projectId: string,
  id: string,
  fetchedAt: string,
): Promise<void> {
  await db
    .update(sourcePageSnapshots)
    .set({ fetchedAt })
    .where(
      and(
        eq(sourcePageSnapshots.projectId, projectId),
        eq(sourcePageSnapshots.id, id),
      ),
    );
}

async function snapshotsByIds(
  projectId: string,
  ids: string[],
): Promise<StoredSnapshot[]> {
  const rows: StoredSnapshot[] = [];
  for (let i = 0; i < ids.length; i += ID_SLICE)
    rows.push(
      ...(await db
        .select()
        .from(sourcePageSnapshots)
        .where(
          and(
            eq(sourcePageSnapshots.projectId, projectId),
            inArray(sourcePageSnapshots.id, ids.slice(i, i + ID_SLICE)),
          ),
        )),
    );
  return rows;
}

async function insertAnalysis(row: StoredAnalysis): Promise<void> {
  await db.insert(sourceGapAnalyses).values(row);
}

async function latestAnalysis(
  projectId: string,
  promptId: string,
): Promise<StoredAnalysis | null> {
  const [row] = await db
    .select()
    .from(sourceGapAnalyses)
    .where(
      and(
        eq(sourceGapAnalyses.projectId, projectId),
        eq(sourceGapAnalyses.promptId, promptId),
      ),
    )
    .orderBy(desc(sourceGapAnalyses.createdAt))
    .limit(1);
  return row ?? null;
}

async function getAnalysis(
  projectId: string,
  id: string,
): Promise<StoredAnalysis | null> {
  const [row] = await db
    .select()
    .from(sourceGapAnalyses)
    .where(
      and(
        eq(sourceGapAnalyses.projectId, projectId),
        eq(sourceGapAnalyses.id, id),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Newest analysis of every prompt in the project, without the result body. */
async function latestAnalysisPerPrompt(projectId: string) {
  const rows = await db
    .select({
      id: sourceGapAnalyses.id,
      promptId: sourceGapAnalyses.promptId,
      createdAt: sourceGapAnalyses.createdAt,
      topRootCause: sourceGapAnalyses.topRootCause,
      ownerUrl: sourceGapAnalyses.ownerUrl,
      ownerConfidence: sourceGapAnalyses.ownerConfidence,
      sourcesAnalyzed: sourceGapAnalyses.sourcesAnalyzed,
      opportunityId: sourceGapAnalyses.opportunityId,
    })
    .from(sourceGapAnalyses)
    .where(eq(sourceGapAnalyses.projectId, projectId))
    .orderBy(desc(sourceGapAnalyses.createdAt));
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.promptId)) return false;
    seen.add(row.promptId);
    return true;
  });
}

async function setAnalysisOpportunity(
  projectId: string,
  id: string,
  opportunityId: string,
  resultJson: string,
): Promise<void> {
  await db
    .update(sourceGapAnalyses)
    .set({ opportunityId, resultJson })
    .where(
      and(
        eq(sourceGapAnalyses.projectId, projectId),
        eq(sourceGapAnalyses.id, id),
      ),
    );
}

async function getOwnerOverride(
  projectId: string,
  promptId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ ownerUrl: sourceGapOwnerOverrides.ownerUrl })
    .from(sourceGapOwnerOverrides)
    .where(
      and(
        eq(sourceGapOwnerOverrides.projectId, projectId),
        eq(sourceGapOwnerOverrides.promptId, promptId),
      ),
    )
    .limit(1);
  return row?.ownerUrl ?? null;
}

async function setOwnerOverride(
  projectId: string,
  promptId: string,
  ownerUrl: string | null,
  now: string,
): Promise<void> {
  await db
    .delete(sourceGapOwnerOverrides)
    .where(
      and(
        eq(sourceGapOwnerOverrides.projectId, projectId),
        eq(sourceGapOwnerOverrides.promptId, promptId),
      ),
    );
  if (ownerUrl)
    await db.insert(sourceGapOwnerOverrides).values({
      id: crypto.randomUUID(),
      projectId,
      promptId,
      ownerUrl,
      createdAt: now,
    });
}

/** The prompt, only when it belongs to the project. */
async function getPrompt(projectId: string, promptId: string) {
  const [row] = await db
    .select({
      id: aiPrompts.id,
      text: aiPrompts.text,
      topic: aiPrompts.topic,
      intent: aiPrompts.intent,
    })
    .from(aiPrompts)
    .innerJoin(aiTrackers, eq(aiTrackers.id, aiPrompts.trackerId))
    .where(and(eq(aiTrackers.projectId, projectId), eq(aiPrompts.id, promptId)))
    .limit(1);
  return row ?? null;
}

/** Titles and addresses from the project's newest finished crawl. */
async function latestAuditPages(projectId: string) {
  const [audit] = await db
    .select({ id: audits.id })
    .from(audits)
    .where(and(eq(audits.projectId, projectId), eq(audits.status, "completed")))
    .orderBy(desc(audits.startedAt))
    .limit(1);
  if (!audit) return [];
  return db
    .select({ url: auditPages.url, title: auditPages.title })
    .from(auditPages)
    .where(
      and(
        eq(auditPages.auditId, audit.id),
        eq(auditPages.statusCode, 200),
        eq(auditPages.isIndexable, true),
      ),
    )
    .limit(2000);
}

export const SourceGapRepository = {
  latestAuditPages,
  latestSnapshot,
  insertSnapshot,
  touchSnapshot,
  snapshotsByIds,
  insertAnalysis,
  latestAnalysis,
  getAnalysis,
  latestAnalysisPerPrompt,
  setAnalysisOpportunity,
  getOwnerOverride,
  setOwnerOverride,
  getPrompt,
};
