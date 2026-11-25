import { captureClaimEvent } from "./claimAnalytics";
import { sort } from "remeda";
import { hostedClaimModel } from "@/server/features/ai-claims/claimFunding";
import type { z } from "zod";
import { AppError } from "@/server/lib/errors";
import type { claimFactInput } from "@/shared/ai-claims";
import { claimJobRepository } from "./claimJobRepository";
import { claimRepository as repo } from "./claimRepository";
import {
  claimReviewer,
  recordClaimEvent,
  requireClaimsAccess,
  type ClaimActor,
} from "./claimJobs";
import {
  ASSESSMENT_RECIPE,
  compareApprovedFacts,
  hashClaimInput,
  propositionScope,
} from "./claimRules";
import { publicEvidenceUrl } from "./claimEvidence";

function isEvidenceUrl(value: string) {
  try {
    publicEvidenceUrl(value);
    return true;
  } catch {
    return false;
  }
}

type Filters = Parameters<typeof repo.listOccurrences>[1];

export async function loadClaimOverview(actor: ClaimActor, filters: Filters) {
  await requireClaimsAccess(actor);
  const [rows, runs, jobs, facts, legacy, assessments] = await Promise.all([
    repo.listOccurrences(actor.projectId, filters),
    claimJobRepository.runs(actor.projectId),
    claimJobRepository.jobs(actor.projectId, actor.userId),
    repo.facts(actor.projectId),
    repo.legacyFacts(actor.projectId),
    repo.recentAssessments(actor.projectId),
  ]);
  const latest = new Map<string, (typeof assessments)[number]>();
  for (const item of assessments)
    if (!latest.has(item.occurrenceId)) latest.set(item.occurrenceId, item);
  const claimRows = new Map(rows.map((row) => [row.claim.id, row.claim]));
  const groups = new Map<string, (typeof rows)[number][]>();
  for (const row of rows.slice(0, 1000)) {
    let key = row.claim.id;
    let parent = row.claim.mergedInto;
    while (parent && parent < key) {
      key = parent;
      parent = claimRows.get(key)?.mergedInto ?? null;
    }
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const clusters = sort(
    Array.from(groups.entries()).map(([clusterId, group]) => {
      const first = group.find((row) => !row.claim.mergedInto) ?? group[0];
      const distinctAnswers = new Map(group.map((row) => [row.answerId, row]));
      const dates = sort(
        [...distinctAnswers.values()].flatMap((row) =>
          row.observedAt ? [row.observedAt] : [],
        ),
        (a, b) => a.localeCompare(b),
      );
      const judgments = group.flatMap((item) => {
        const assessment = latest.get(item.occurrence.id);
        return assessment ? [assessment] : [];
      });
      const status = judgments.some(
        (item) => item.status === "conflict" && item.review === "confirmed",
      )
        ? "confirmed"
        : judgments.some(
              (item) =>
                (item.status === "conflict" || item.status === "mixed") &&
                item.review === null,
            )
          ? "review"
          : judgments.some((item) => item.status === "consistent")
            ? "consistent"
            : "unverified";
      return {
        id: clusterId,
        proposition: claimRows.get(clusterId) ?? first.claim,
        status,
        occurrenceCount: group.length,
        count: distinctAnswers.size,
        prompts: new Set(group.map((row) => row.promptId)).size,
        runs: new Set(group.map((row) => row.runId)).size,
        engines: new Set(group.map((row) => row.engine)).size,
        firstSeen: dates[0],
        lastSeen: dates.at(-1),
        dates,
        variants: [...new Set(group.map((row) => row.claim.value))],
        occurrences: group
          .slice(0, 30)
          .map(({ occurrence, claim, answer, ...metadata }) => ({
            ...metadata,
            occurrenceId: occurrence.id,
            claimId: claim.id,
            confidence: occurrence.confidence,
            start: occurrence.start,
            end: occurrence.end,
            quote: answer?.slice(occurrence.start, occurrence.end) ?? "",
          })),
      };
    }),
    (a, b) => b.count - a.count,
  );
  const related = new Map<string, typeof clusters>();
  for (const cluster of clusters) {
    const key = JSON.stringify(propositionScope(cluster.proposition));
    const bucket = related.get(key) ?? [];
    bucket.push(cluster);
    related.set(key, bucket);
  }
  const grouped = clusters.map((cluster) => ({
    ...cluster,
    alternatives: (
      related.get(JSON.stringify(propositionScope(cluster.proposition))) ?? []
    )
      .filter(
        (other) =>
          other.id !== cluster.id &&
          other.proposition.effectiveDate === cluster.proposition.effectiveDate,
      )
      .slice(0, 6)
      .map((other) => ({
        id: other.id,
        value: other.proposition.value,
        polarity: other.proposition.polarity,
      })),
  }));
  const recentJobs = await Promise.all(
    jobs
      .filter((job) => job.status !== "ready")
      .slice(0, 5)
      .map(async (job) => {
        const results = await claimJobRepository.items(job.id);
        return {
          id: job.id,
          status: job.status,
          createdAt: job.createdAt,
          counts: results.reduce<Record<string, number>>((counts, item) => {
            counts[item.status] = (counts[item.status] ?? 0) + 1;
            return counts;
          }, {}),
          errors: [
            ...(job.billingError ? [job.billingError] : []),
            ...new Set(
              results.flatMap((item) =>
                item.errorCode ? [item.errorCode] : [],
              ),
            ),
          ],
          inputTokens: results.reduce(
            (sum, item) => sum + (item.inputTokens ?? 0),
            0,
          ),
          outputTokens: results.reduce(
            (sum, item) => sum + (item.outputTokens ?? 0),
            0,
          ),
          knownUsd: results.reduce((sum, item) => sum + (item.costUsd ?? 0), 0),
          unpriced: results.filter(
            (item) =>
              ["completed", "review", "unknown"].includes(item.status) &&
              item.costUsd === null,
          ).length,
        };
      }),
  );
  return {
    clusters: grouped,
    sampled: rows.length > 1000,
    runs,
    jobs: recentJobs,
    facts: facts.slice(0, 250),
    legacy,
    reviewer: claimReviewer(actor.role),
    hostedAvailable:
      claimReviewer(actor.role) &&
      !!(await hostedClaimModel(actor.organizationId)),
  };
}

export async function savedOccurrence(actor: ClaimActor, id: string) {
  const row = await repo.findOccurrence(actor.projectId, id);
  if (
    !row ||
    !row.answer ||
    (await hashClaimInput(row.answer)) !== row.inputHash
  )
    throw new AppError("NOT_FOUND", "The saved claim evidence is unavailable.");
  return row;
}

export async function draftClaimFact(
  actor: ClaimActor,
  input: z.infer<typeof claimFactInput>,
) {
  await requireClaimsAccess(actor);
  const { previousId, legacyFactId, sourceUrl, ...data } = input;
  if (sourceUrl && !isEvidenceUrl(sourceUrl))
    throw new AppError(
      "VALIDATION_ERROR",
      "Use a public HTTP or HTTPS source URL.",
    );
  const previous = previousId
    ? await repo.fact(actor.projectId, previousId)
    : undefined;
  if (
    previous &&
    JSON.stringify(propositionScope(previous)) !==
      JSON.stringify(propositionScope(data))
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "Create a separate fact for a different scope.",
    );
  if (previousId && (!previous || previous.state !== "approved"))
    throw new AppError(
      "NOT_FOUND",
      "The selected fact version is unavailable.",
    );
  const legacy = legacyFactId
    ? (await repo.legacyFacts(actor.projectId)).find(
        (fact) => fact.id === legacyFactId,
      )
    : undefined;
  if (legacyFactId && !legacy)
    throw new AppError("NOT_FOUND", "The selected legacy fact is unavailable.");
  if ((await repo.facts(actor.projectId)).length >= 250)
    throw new AppError(
      "VALIDATION_ERROR",
      "The registry has reached its version limit.",
    );
  const id = crypto.randomUUID();
  await repo.saveFact({
    ...data,
    id,
    previousId,
    legacyFactId,
    sourceUrl,
    factKey: previous?.factKey ?? id,
    createdAt: new Date().toISOString(),
    projectId: actor.projectId,
    ownerId: actor.userId,
    state: "draft",
  });
  await recordClaimEvent(actor, id, "Drafted a fact version");
}

export async function reviewClaimFact(
  actor: ClaimActor,
  id: string,
  action: "approve" | "retire",
) {
  await requireClaimsAccess(actor);
  if (!claimReviewer(actor.role))
    throw new AppError("FORBIDDEN", "Only owners and admins can review facts.");
  const fact = await repo.fact(actor.projectId, id);
  if (
    !fact ||
    (action === "approve"
      ? fact.state !== "draft"
      : fact.state !== "approved" && fact.state !== "draft")
  )
    throw new AppError(
      "NOT_FOUND",
      "This fact version is no longer available for review.",
    );
  await repo.review(fact, actor.userId, new Date().toISOString(), action);
  if (
    (await repo.fact(actor.projectId, id))?.state !==
    (action === "approve"
      ? "approved"
      : fact.state === "draft"
        ? "discarded"
        : "retired")
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "The fact version changed during review.",
    );
  await recordClaimEvent(
    actor,
    id,
    action === "approve" ? "Approved a fact version" : "Retired a fact version",
  );
  if (action === "approve") await captureClaimEvent(actor, "fact_approved");
}

export async function assessClaim(actor: ClaimActor, id: string) {
  await requireClaimsAccess(actor);
  const row = await savedOccurrence(actor, id);
  const date = row.claim.effectiveDate ?? row.observedAt?.slice(0, 10);
  const facts = date ? await repo.applicableFacts(actor.projectId, date) : [];
  const current = facts.filter(
    (fact, index) =>
      facts.findIndex((candidate) => candidate.factKey === fact.factKey) ===
      index,
  );
  const applicable = current.filter(
    (fact) =>
      fact.state !== "retired" ||
      (date && fact.reviewedAt && date < fact.reviewedAt.slice(0, 10)),
  );
  const result = compareApprovedFacts(row.claim, row.observedAt, applicable);
  const factIds = sort(
    result.matches.map((fact) => fact.id),
    (a, b) => a.localeCompare(b),
  );
  const inputHash = await hashClaimInput(
    JSON.stringify([row.inputHash, date, factIds, result.status]),
  );
  const assessmentId = await hashClaimInput(
    JSON.stringify([id, ASSESSMENT_RECIPE, inputHash]),
  );
  await repo.saveAssessment(
    {
      id: assessmentId,
      projectId: actor.projectId,
      occurrenceId: id,
      status: result.status,
      rationale: result.rationale,
      recipe: ASSESSMENT_RECIPE,
      inputHash,
      createdAt: new Date().toISOString(),
    },
    factIds,
  );
}

export async function reviewClaimAssessment(
  actor: ClaimActor,
  id: string,
  review: "confirmed" | "dismissed",
) {
  await requireClaimsAccess(actor);
  if (!claimReviewer(actor.role))
    throw new AppError(
      "FORBIDDEN",
      "Only owners and admins can review assessments.",
    );
  const [reviewed] = await repo.reviewAssessment(
    actor.projectId,
    id,
    actor.userId,
    review,
    new Date().toISOString(),
  );
  if (!reviewed)
    throw new AppError(
      "NOT_FOUND",
      "This assessment is unavailable for review.",
    );
  await recordClaimEvent(
    actor,
    id,
    review === "confirmed"
      ? "Confirmed a claim conflict"
      : "Dismissed a claim assessment",
  );
  await captureClaimEvent(actor, "claim_reviewed");
}
