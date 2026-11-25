import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { chunk, sortBy } from "remeda";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  linkEvidence,
  linkGapCandidateCompetitors,
  linkGapCandidates,
  linkGapRunCompetitors,
  linkGapRuns,
  linkQualificationSettings,
} from "@/db/schema";
import type { ContextAuthor } from "@/types/schemas/projectContext";
import type { MergedLinkCandidate } from "../rules/linkGapMerge";
import {
  DEFAULT_QUALIFICATION_SETTINGS,
  type QualificationSettings,
} from "../rules/qualification";

// D1 caps bound parameters per statement, so multi-row writes are chunked by
// the number of columns each row binds.
const CANDIDATES_PER_INSERT = 9;
const COMPETITOR_STATS_PER_INSERT = 8;
const EVIDENCE_PER_INSERT = 3;
const ID_CHUNK = 90;

type LinkGapRunRecord = typeof linkGapRuns.$inferSelect;
export type LinkEvidenceRecord = typeof linkEvidence.$inferSelect;
export type LinkEvidenceInput = Omit<LinkEvidenceRecord, "id">;

async function saveRun(input: {
  run: Omit<LinkGapRunRecord, "createdAt" | "rowCount">;
  competitors: string[];
  candidates: MergedLinkCandidate[];
  observedAt: string;
}): Promise<void> {
  const { run, candidates } = input;
  const ids = candidates.map(() => crypto.randomUUID());
  await runBatch((tx) => [
    tx.insert(linkGapRuns).values({ ...run, rowCount: candidates.length }),
    ...(input.competitors.length === 0
      ? []
      : [
          tx.insert(linkGapRunCompetitors).values(
            input.competitors.map((competitorDomain, index) => ({
              runId: run.id,
              competitorDomain,
              position: index + 1,
            })),
          ),
        ]),
    ...chunk(candidates, CANDIDATES_PER_INSERT).map((part, partIndex) =>
      tx.insert(linkGapCandidates).values(
        part.map((candidate, i) => ({
          id: ids[partIndex * CANDIDATES_PER_INSERT + i] ?? crypto.randomUUID(),
          runId: run.id,
          projectId: run.projectId,
          referringDomain: candidate.referringDomain,
          competitorCount: candidate.competitorCount,
          domainRank: candidate.domainRank,
          spamScore: candidate.spamScore,
          firstSeen: candidate.firstSeen,
          lostDate: candidate.lostDate,
          observedAt: input.observedAt,
        })),
      ),
    ),
    ...chunk(
      candidates.flatMap((candidate, index) =>
        candidate.competitors.map((stats) => ({
          candidateId: ids[index] ?? "",
          ...stats,
        })),
      ),
      COMPETITOR_STATS_PER_INSERT,
    ).map((part) => tx.insert(linkGapCandidateCompetitors).values(part)),
  ]);
}

async function getRun(projectId: string, runId: string) {
  const [row] = await db
    .select()
    .from(linkGapRuns)
    .where(and(eq(linkGapRuns.projectId, projectId), eq(linkGapRuns.id, runId)))
    .limit(1);
  return row ?? null;
}

async function latestRun(projectId: string) {
  const [row] = await db
    .select()
    .from(linkGapRuns)
    .where(eq(linkGapRuns.projectId, projectId))
    .orderBy(desc(linkGapRuns.createdAt))
    .limit(1);
  return row ?? null;
}

async function listRuns(projectId: string, limit: number) {
  return db
    .select()
    .from(linkGapRuns)
    .where(eq(linkGapRuns.projectId, projectId))
    .orderBy(desc(linkGapRuns.createdAt))
    .limit(limit);
}

async function runCompetitors(runId: string) {
  const rows = await db
    .select()
    .from(linkGapRunCompetitors)
    .where(eq(linkGapRunCompetitors.runId, runId));
  return sortBy(rows, (row) => row.position).map((row) => row.competitorDomain);
}

/** Every candidate of a run with its per-competitor stats, rebuilt as merged rows. */
async function candidatesOfRun(
  projectId: string,
  runId: string,
): Promise<Array<MergedLinkCandidate & { id: string; observedAt: string }>> {
  const candidates = await db
    .select()
    .from(linkGapCandidates)
    .where(
      and(
        eq(linkGapCandidates.projectId, projectId),
        eq(linkGapCandidates.runId, runId),
      ),
    );
  const stats = (
    await Promise.all(
      chunk(
        candidates.map((c) => c.id),
        ID_CHUNK,
      ).map((ids) =>
        db
          .select()
          .from(linkGapCandidateCompetitors)
          .where(inArray(linkGapCandidateCompetitors.candidateId, ids)),
      ),
    )
  ).flat();
  return candidates.map((candidate) => ({
    id: candidate.id,
    observedAt: candidate.observedAt,
    referringDomain: candidate.referringDomain,
    competitorCount: candidate.competitorCount,
    domainRank: candidate.domainRank,
    spamScore: candidate.spamScore,
    firstSeen: candidate.firstSeen,
    lostDate: candidate.lostDate,
    competitors: stats
      .filter((row) => row.candidateId === candidate.id)
      .map(({ candidateId: _candidateId, ...row }) => row),
  }));
}

async function saveEvidence(rows: LinkEvidenceInput[]): Promise<void> {
  if (rows.length === 0) return;
  await runBatch((tx) =>
    chunk(rows, EVIDENCE_PER_INSERT).map((part) =>
      tx
        .insert(linkEvidence)
        .values(part.map((row) => ({ id: crypto.randomUUID(), ...row })))
        .onConflictDoUpdate({
          target: [
            linkEvidence.projectId,
            linkEvidence.urlFrom,
            linkEvidence.urlTo,
          ],
          set: {
            competitorDomain: sql`excluded.competitor_domain`,
            anchor: sql`excluded.anchor`,
            textBefore: sql`excluded.text_before`,
            textAfter: sql`excluded.text_after`,
            lastSeen: sql`excluded.last_seen`,
            lostDate: sql`excluded.lost_date`,
            collectedAt: sql`excluded.collected_at`,
          },
        }),
    ),
  );
}

async function evidenceForDomains(projectId: string, domains: string[]) {
  if (domains.length === 0) return [];
  const rows = await Promise.all(
    chunk(domains, ID_CHUNK).map((part) =>
      db
        .select()
        .from(linkEvidence)
        .where(
          and(
            eq(linkEvidence.projectId, projectId),
            inArray(linkEvidence.referringDomain, part),
          ),
        ),
    ),
  );
  return rows.flat();
}

async function getSettings(projectId: string): Promise<QualificationSettings> {
  const [row] = await db
    .select()
    .from(linkQualificationSettings)
    .where(eq(linkQualificationSettings.projectId, projectId))
    .limit(1);
  if (!row) return DEFAULT_QUALIFICATION_SETTINGS;
  const {
    projectId: _projectId,
    updatedAt: _at,
    updatedBy: _by,
    ...settings
  } = row;
  return settings;
}

async function saveSettings(
  projectId: string,
  settings: QualificationSettings,
  updatedBy: ContextAuthor,
) {
  const values = {
    ...settings,
    updatedBy,
    updatedAt: new Date().toISOString(),
  };
  await db
    .insert(linkQualificationSettings)
    .values({ projectId, ...values })
    .onConflictDoUpdate({
      target: linkQualificationSettings.projectId,
      set: values,
    });
}

export const LinkGapRepository = {
  saveRun,
  getRun,
  latestRun,
  listRuns,
  runCompetitors,
  candidatesOfRun,
  saveEvidence,
  evidenceForDomains,
  getSettings,
  saveSettings,
};
