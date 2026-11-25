import { claimGroupRepository } from "./claimGroupRepository";
import { AppError } from "@/server/lib/errors";
import { claimRepository as repo } from "./claimRepository";
import {
  claimReviewer,
  recordClaimEvent,
  requireClaimsAccess,
  type ClaimActor,
} from "./claimJobs";
import {
  compareRecurringPrices,
  monthlyPricePredicates,
  normalizeClaimText,
  propositionScope,
  recurringPriceCadence,
  yearlyPricePredicates,
} from "./claimRules";

type Claim = NonNullable<Awaited<ReturnType<typeof repo.claim>>>;
const equivalents = [
  monthlyPricePredicates,
  yearlyPricePredicates,
  ["supported languages", "available languages", "language support"],
  ["available integrations", "supported integrations"],
  ["free trial", "free trial availability", "trial availability"],
];

export function sameClaimQualifiers(source: Claim, target: Claim) {
  const sameValue =
    recurringPriceCadence(source.predicate, source.plan) ||
    recurringPriceCadence(target.predicate, target.plan)
      ? compareRecurringPrices(source, target) === "same"
      : normalizeClaimText(source.value) === normalizeClaimText(target.value);
  return (
    source.category === target.category &&
    source.polarity === target.polarity &&
    source.effectiveDate === target.effectiveDate &&
    sameValue &&
    JSON.stringify(
      propositionScope(source).filter((_, index) => index !== 1),
    ) ===
      JSON.stringify(propositionScope(target).filter((_, index) => index !== 1))
  );
}

export async function claimGroupSuggestions(actor: ClaimActor, id: string) {
  await requireClaimsAccess(actor);
  const source = await repo.claim(actor.projectId, id);
  if (!source) throw new AppError("NOT_FOUND", "Claim unavailable.");
  const family = equivalents.find((group) =>
    group.includes(normalizeClaimText(source.predicate) ?? ""),
  );
  const suggestions =
    source.mergedInto || !family
      ? []
      : (await claimGroupRepository.groupCandidates(source))
          .filter(
            (candidate) =>
              candidate.id < id &&
              sameClaimQualifiers(source, candidate) &&
              family.includes(normalizeClaimText(candidate.predicate) ?? ""),
          )
          .slice(0, 8)
          .map((candidate) => ({
            id: candidate.id,
            predicate: candidate.predicate,
            value: candidate.value,
            rationale:
              "The predicates are known paraphrases. The value, subject, polarity and qualifiers agree.",
          }));
  return {
    suggestions,
    history: await claimGroupRepository.groupHistory(actor.projectId, id),
  };
}

export async function groupClaims(
  actor: ClaimActor,
  id: string,
  target: string | null,
) {
  await requireClaimsAccess(actor);
  if (!claimReviewer(actor.role))
    throw new AppError(
      "FORBIDDEN",
      "Only owners and admins can regroup claims.",
    );
  const source = await repo.claim(actor.projectId, id);
  const other = target ? await repo.claim(actor.projectId, target) : undefined;
  if (!source || (target && (!other || id <= target)))
    throw new AppError("NOT_FOUND", "Claim group unavailable.");
  if (other && !sameClaimQualifiers(source, other))
    throw new AppError(
      "VALIDATION_ERROR",
      "Claim qualifiers or values differ. Review them independently.",
    );
  if (source.mergedInto === target) return;
  if (!(await claimGroupRepository.group(source, target, actor.userId)))
    throw new AppError(
      "VALIDATION_ERROR",
      "Claim group changed during review.",
    );
  await recordClaimEvent(
    actor,
    id,
    target ? "Grouped a claim variant" : "Separated a claim variant",
  );
}
