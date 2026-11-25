import { captureClaimEvent } from "./claimAnalytics";
import { aiCostForAnswers } from "@/server/features/ai-visibility/services/aiVisibilityCost";
import { aiScope } from "@/server/features/ai-visibility/services/aiVisibilityConfiguration";
import { requireConfiguration } from "@/server/features/ai-visibility/services/aiVisibilityMutation";
import { startRun } from "@/server/features/ai-visibility/services/aiVisibilityRuns";
import { walletCreditsPerAnswer } from "@/shared/wallet-pricing";
import { walletAccount } from "@/server/features/billing/wallet";
import type { CustomerContext } from "@/server/lib/customer-context";
import { AppError } from "@/server/lib/errors";
import { claimCorrectionRepository as repo } from "./claimCorrectionRepository";
import { claimRepository } from "./claimRepository";
import { correction, requireCorrectionReviewer } from "./claimCorrections";
import { recordClaimEvent, type ClaimActor } from "./claimJobs";
import { compareApprovedFacts } from "./claimRules";
import { savedOccurrence } from "./claimService";

export async function recordClaimFollowup(
  actor: ClaimActor,
  id: string,
  observationId: string,
) {
  await requireCorrectionReviewer(actor);
  const row = await correction(actor, id);
  const baseline = await repo.baseline(row);
  const entry = (await repo.relatedLedger(row)).find(
    (item) =>
      item.status === "executed" &&
      item.publicationStatus === "published" &&
      item.targetUrl === row.targetUrl,
  );
  const publishedAt =
    entry?.provider === "manual" ? entry.executedAt : entry?.updatedAt;
  if (!baseline || !entry || !publishedAt)
    throw new AppError(
      "VALIDATION_ERROR",
      "Verify a publication before recording a follow-up.",
    );
  const candidate = (
    await repo.candidates(actor.projectId, baseline, publishedAt)
  ).find((item) => item.id === observationId);
  if (!candidate)
    throw new AppError(
      "VALIDATION_ERROR",
      "Select a comparable post-publication answer.",
    );
  const prior = (await repo.history(row.id)).find(
    (item) => item.observationId === candidate.id,
  );
  if (prior) return prior.outcome;
  const reading = await repo.readings(actor.projectId, candidate.id);
  if (!reading)
    throw new AppError(
      "VALIDATION_ERROR",
      "Extract claims from the selected follow-up answer first.",
    );
  const fact = await claimRepository.fact(actor.projectId, row.factVersionId);
  const outcomes =
    reading && fact
      ? reading.claims.map(
          (claim) =>
            compareApprovedFacts(claim, candidate.collectedAt, [fact]).status,
        )
      : [];
  // Identical answer text carries the reviewed quote even when a second
  // extraction describes its qualifiers differently.
  if (
    candidate.sameAnswer &&
    baseline.observation.model &&
    row.assessmentId &&
    fact?.state === "approved"
  ) {
    const assessment = await repo.assessment(actor.projectId, row.assessmentId);
    if (assessment?.review === "confirmed") {
      const original = await savedOccurrence(actor, assessment.occurrenceId);
      if (original.answerId === baseline.observation.id)
        outcomes.push(
          compareApprovedFacts(original.claim, candidate.collectedAt, [fact])
            .status,
        );
    }
  }
  const outcome =
    outcomes.includes("conflict") || outcomes.includes("mixed")
      ? "conflict_persists"
      : outcomes.includes("consistent")
        ? "matches_fact"
        : reading?.complete && baseline.observation.model
          ? "not_found_in_extraction"
          : "inconclusive";
  await repo.record(
    {
      id: crypto.randomUUID(),
      correctionId: id,
      ledgerId: entry.id,
      observationId,
      outcome,
      actorId: actor.userId,
      createdAt: new Date().toISOString(),
    },
    candidate.runId,
  );
  await recordClaimEvent(
    actor,
    id,
    "Recorded a post-publication claim reading",
  );
  await captureClaimEvent(actor, "verification_reading_recorded", outcome);
  return outcome;
}

export async function recheckClaimCorrection(
  actor: ClaimActor & CustomerContext,
  id: string,
  approval?: {
    maxCostUsd: number;
    maxCredits: number;
  },
) {
  await requireCorrectionReviewer(actor);
  const row = await correction(actor, id);
  const [baseline, entries, config] = await Promise.all([
    repo.baseline(row),
    repo.relatedLedger(row),
    requireConfiguration(actor.projectId),
  ]);
  if (
    !baseline ||
    !entries.some(
      (entry) =>
        entry.status === "executed" &&
        entry.publicationStatus === "published" &&
        entry.targetUrl === row.targetUrl,
    )
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "A published correction and saved baseline are required.",
    );
  const promptIds = [baseline.observation.promptId];
  const engine = baseline.observation.engine;
  const scope = aiScope(config, promptIds);
  if (
    scope.prompts.length !== 1 ||
    scope.prompts[0]?.id !== promptIds[0] ||
    !scope.engines.includes(engine)
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "The original prompt or engine is no longer active.",
    );
  const costUsd = aiCostForAnswers([engine], "live").costUsd;
  const wallet = await walletAccount(actor.organizationId);
  const credits = wallet.enabled ? walletCreditsPerAnswer(engine, "live") : 0;
  if (!approval) return { costUsd, credits, engine, runId: null };
  if (approval.maxCostUsd < costUsd || approval.maxCredits !== credits)
    throw new AppError(
      "VALIDATION_ERROR",
      "The recheck estimate changed. Review a fresh estimate.",
    );
  const run = await startRun(config, "manual", actor, {
    promptIds,
    onlyEngine: engine,
    maxWalletCredits: wallet.enabled ? credits : undefined,
    market: { locationCode: baseline.market, languageCode: baseline.language },
  });
  await recordClaimEvent(actor, id, "Started a one-answer correction recheck");
  await captureClaimEvent(actor, "verification_started");
  return { costUsd, credits, engine, runId: run.id };
}
