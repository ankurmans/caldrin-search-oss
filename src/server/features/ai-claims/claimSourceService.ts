import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { AppError } from "@/server/lib/errors";
import { claimRepository as repo } from "./claimRepository";
import {
  claimReviewer,
  recordClaimEvent,
  requireClaimsAccess,
  type ClaimActor,
} from "./claimJobs";
import { inspectPublicEvidence, publicEvidenceUrl } from "./claimEvidence";
import { hashClaimInput } from "./claimRules";
import { savedOccurrence } from "./claimService";

function maybeUrl(raw: string) {
  try {
    return publicEvidenceUrl(raw);
  } catch {
    return null;
  }
}

async function loadSources(actor: ClaimActor, answerId: string) {
  const [sources, project, facts] = await Promise.all([
    repo.sourceRows(answerId),
    ProjectRepository.getProjectForOrganization(
      actor.projectId,
      actor.organizationId,
    ),
    repo.facts(actor.projectId),
  ]);
  const owned = project?.domain
    ? maybeUrl(`https://${project.domain.replace(/^https?:\/\//i, "")}`)
    : null;
  return [
    ...(owned ? [{ url: owned, type: "Owned site", title: null }] : []),
    ...sources.citations.map((source) => ({
      url: source.url,
      type:
        source.origin === "answer_link"
          ? "Answer link"
          : "Reported source · citation may be unconfirmed",
      title: source.title,
    })),
    ...sources.retrievals.map((source) => ({
      url: source.url,
      type: "Reported retrieval",
      title: source.title,
    })),
    ...facts.flatMap((fact) =>
      fact.state === "approved" && fact.sourceUrl
        ? [{ url: fact.sourceUrl, type: "Approved fact source", title: null }]
        : [],
    ),
  ]
    .flatMap((source) => {
      const url = maybeUrl(source.url);
      return url ? [{ ...source, url }] : [];
    })
    .filter(
      (source, index, all) =>
        all.findIndex(
          (other) => other.url === source.url && other.type === source.type,
        ) === index,
    )
    .slice(0, 50);
}

export async function getClaimEvidence(actor: ClaimActor, id: string) {
  await requireClaimsAccess(actor);
  const row = await savedOccurrence(actor, id);
  const [sources, assessments] = await Promise.all([
    loadSources(actor, row.answerId),
    repo.assessments(actor.projectId, id),
  ]);
  const [snapshots, history, sourceReviews] = await Promise.all([
    repo.snapshots(
      actor.projectId,
      [...new Set(sources.map((source) => source.url))],
      new Date(Date.now() - 180 * 86400_000).toISOString(),
    ),
    Promise.all(
      assessments.map(async (assessment) => ({
        ...assessment,
        facts: (
          await repo.assessmentEvidence(actor.projectId, assessment.id)
        ).map((link) => link.fact),
      })),
    ),
    repo.sourceReviews(actor.projectId, id),
  ]);
  return {
    sources: sources.map((source) => ({
      ...source,
      snapshot: snapshots.find((snapshot) => snapshot.url === source.url),
    })),
    history,
    sourceReviews,
  };
}

export async function captureClaimEvidence(
  actor: ClaimActor,
  id: string,
  rawUrl: string,
  passage: string,
) {
  await requireClaimsAccess(actor);
  if (!claimReviewer(actor.role))
    throw new AppError("FORBIDDEN", "An owner or admin can fetch evidence.");
  const row = await savedOccurrence(actor, id);
  const url = maybeUrl(rawUrl);
  if (
    !url ||
    !(await loadSources(actor, row.answerId)).some(
      (source) => source.url === url,
    )
  )
    throw new AppError(
      "NOT_FOUND",
      "This URL is unavailable for the selected answer.",
    );
  const now = new Date();
  // A shared project/URL/day reservation deduplicates concurrent requests.
  const key = await hashClaimInput(
    JSON.stringify([actor.projectId, url, now.toISOString().slice(0, 10)]),
  );
  if (
    (await repo.dailySnapshots(
      actor.projectId,
      `${now.toISOString().slice(0, 10)}T00:00:00.000Z`,
    )) >= 10
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "This project reached its daily evidence fetch limit.",
    );
  const reserved = await repo.reserveSnapshot({
    id: key,
    projectId: actor.projectId,
    url,
    fetchedAt: now.toISOString(),
    reason: "fetch_pending",
  });
  if (!reserved.length) return;
  const snapshot = await inspectPublicEvidence(url, passage).catch(() => ({
    reason: "source_unavailable",
  }));
  await repo.finishSnapshot(actor.projectId, key, snapshot);
}

export async function reviewClaimSource(
  actor: ClaimActor,
  id: string,
  input: {
    snapshotId: string;
    relation:
      | "corroborating"
      | "conflicting"
      | "potentially_stale"
      | "insufficient";
    relevance: "direct" | "context_only";
    rationale: string;
  },
) {
  await requireClaimsAccess(actor);
  if (!claimReviewer(actor.role))
    throw new AppError(
      "FORBIDDEN",
      "Only owners and admins can review source evidence.",
    );
  const row = await savedOccurrence(actor, id);
  const sources = await loadSources(actor, row.answerId);
  const since = new Date(Date.now() - 180 * 86400_000).toISOString();
  const snapshot = (
    await repo.snapshots(
      actor.projectId,
      [...new Set(sources.map((source) => source.url))],
      since,
    )
  ).find((candidate) => candidate.id === input.snapshotId);
  if (!snapshot || (!snapshot.excerpt && input.relation !== "insufficient"))
    throw new AppError(
      "VALIDATION_ERROR",
      "The review needs a current captured passage.",
    );
  const reviewId = crypto.randomUUID();
  await repo.saveSourceReview({
    ...input,
    id: reviewId,
    projectId: actor.projectId,
    occurrenceId: id,
    reviewerId: actor.userId,
    createdAt: new Date().toISOString(),
  });
  await recordClaimEvent(actor, reviewId, "Reviewed claim source evidence");
}
