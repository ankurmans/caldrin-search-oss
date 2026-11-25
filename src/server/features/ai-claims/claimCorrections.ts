import { captureClaimEvent } from "./claimAnalytics";
import { AppError } from "@/server/lib/errors";
import { ownsEditorialUrl } from "@/shared/editorialUrl";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import { LedgerService } from "@/server/features/ledger/services/LedgerService";
import { LedgerRepository } from "@/server/features/ledger/repositories/LedgerRepository";
import { claimCorrectionRepository as repo } from "./claimCorrectionRepository";
import { claimRepository, type SavedFact } from "./claimRepository";
import {
  claimReviewer,
  recordClaimEvent,
  requireClaimsAccess,
  type ClaimActor,
} from "./claimJobs";
import { savedOccurrence } from "./claimService";
import { getClaimEvidence } from "./claimSourceService";
import { inspectPublicEvidence, publicEvidenceUrl } from "./claimEvidence";
import { compareApprovedFacts, hashClaimInput } from "./claimRules";

export async function requireCorrectionReviewer(actor: ClaimActor) {
  await requireClaimsAccess(actor);
  if (!claimReviewer(actor.role))
    throw new AppError(
      "FORBIDDEN",
      "Only owners and admins can approve claim corrections.",
    );
}

export async function correction(actor: ClaimActor, id: string) {
  await requireClaimsAccess(actor);
  const selected = await repo.get(actor.projectId, id);
  if (!selected) throw new AppError("NOT_FOUND", "Correction unavailable.");
  return selected;
}

function factCopy(fact: SavedFact) {
  return [
    fact.subject,
    fact.product,
    fact.plan,
    `${fact.predicate}: ${fact.polarity === "denies" ? "does not apply to " : ""}${fact.value}`,
    fact.market,
    fact.version,
    fact.condition,
  ]
    .filter(Boolean)
    .join(" · ");
}

export async function createClaimCorrection(
  actor: ClaimActor,
  input: {
    assessmentId: string;
    factId: string;
    kind: "owned" | "external";
    targetUrl: string;
  },
) {
  await requireCorrectionReviewer(actor);
  const assessment = await repo.assessment(actor.projectId, input.assessmentId);
  if (
    !assessment ||
    assessment.status !== "conflict" ||
    assessment.review !== "confirmed"
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "Confirm the conflicting claim first.",
    );
  const answer = await savedOccurrence(actor, assessment.occurrenceId);
  const facts = await claimRepository.assessmentEvidence(
    actor.projectId,
    assessment.id,
  );
  const fact = facts.find((row) => row.fact.id === input.factId)?.fact;
  const today = new Date().toISOString().slice(0, 10);
  if (
    !fact ||
    fact.state !== "approved" ||
    fact.effectiveFrom > today ||
    (fact.effectiveUntil && fact.effectiveUntil <= today) ||
    compareApprovedFacts(answer.claim, answer.observedAt, [fact]).status !==
      "conflict"
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "Choose a currently approved fact that conflicts with this assertion.",
    );
  const targetUrl = publicEvidenceUrl(input.targetUrl);
  if (new URL(targetUrl).search)
    throw new AppError(
      "VALIDATION_ERROR",
      "Use the canonical target URL without query parameters.",
    );
  const project = await ProjectRepository.getProjectForOrganization(
    actor.projectId,
    actor.organizationId,
  );
  const owned = ownsEditorialUrl(project?.domain, targetUrl);
  const references = await getClaimEvidence(actor, assessment.occurrenceId);
  const source = references.sources.find((item) => item.url === targetUrl);
  if (
    (input.kind === "owned" && !owned) ||
    (input.kind === "external" && (owned || !source))
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "Choose an owned page or an external URL recorded for this answer.",
    );
  const id = await hashClaimInput(
    JSON.stringify([
      actor.projectId,
      assessment.id,
      fact.id,
      input.kind,
      targetUrl,
    ]),
  );
  const existing = await repo.get(actor.projectId, id);
  if (existing) return existing;
  const { start, end } = answer.occurrence;
  const quote = answer.answer!.slice(start, end);
  const replacement = factCopy(fact);
  const title =
    `Correct ${answer.claim.predicate} for ${answer.claim.subject}`.slice(
      0,
      160,
    );
  const brief = [
    `Target: ${targetUrl}`,
    `Approved replacement: ${replacement}`,
    `Effective from ${fact.effectiveFrom}${fact.effectiveUntil ? ` until ${fact.effectiveUntil}` : ""}.`,
    `Approval evidence: ${fact.evidence}`,
    fact.sourceUrl ? `Official source: ${fact.sourceUrl}` : "",
    "Update the affected sentence only. Preserve the page's surrounding content and intent. Confirm the existing wording before editing.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const outreachDraft =
    input.kind === "external"
      ? [
          `Subject: Factual update for your page about ${answer.claim.subject}`,
          `Hello, could you check the statement about ${answer.claim.predicate} on ${targetUrl}?`,
          `The current verified detail is ${replacement}. It applies from ${fact.effectiveFrom}.`,
          fact.sourceUrl
            ? `Official reference: ${fact.sourceUrl}`
            : `Verified context: ${fact.evidence}`,
          "If your page reports a different detail, would you consider updating it? Thank you.",
        ].join("\n\n")
      : null;
  const evidence = [
    {
      source: "ai_claim",
      label: "Saved answer quote",
      value: quote,
      observedAt: answer.observedAt,
    },
    {
      source: "ai_claim",
      label: "Claim, answer and run IDs",
      value: [answer.claim.id, answer.answerId, answer.runId].join(" · "),
    },
    {
      source: "approved_fact",
      label: "Approved fact version",
      value: `${fact.id} · ${replacement}`,
      url: fact.sourceUrl,
    },
  ];
  const row = {
    id,
    projectId: actor.projectId,
    assessmentId: assessment.id,
    claimId: answer.claim.id,
    opportunityId: `claim-opportunity:${id}`,
    assetId: input.kind === "owned" ? `claim-draft:${id}` : null,
    outreachDraft,
    kind: input.kind,
    targetUrl,
    baselineRunId: answer.runId,
    baselineObservationId: answer.answerId,
    factVersionId: fact.id,
    beforeSnapshotId: source?.snapshot?.id,
    createdAt: new Date().toISOString(),
  };
  await repo.insert({
    correction: row,
    actorId: actor.userId,
    organizationId: actor.organizationId,
    title,
    brief,
    replacement,
    evidence,
  });
  await recordClaimEvent(
    actor,
    id,
    "Created a correction opportunity and draft",
  );
  await captureClaimEvent(actor, "opportunity_created");
  if (row.assetId) await captureClaimEvent(actor, "content_drafted");
  return repo.get(actor.projectId, id);
}

export async function listClaimCorrections(
  actor: ClaimActor,
  assessmentId: string,
) {
  await requireClaimsAccess(actor);
  const corrections = await repo.list(actor.projectId, assessmentId);
  return Promise.all(
    corrections.map(async (row) => {
      const [entries, history, baseline] = await Promise.all([
        repo.relatedLedger(row),
        repo.history(row.id),
        repo.baseline(row),
      ]);
      const published = entries.find(
        (entry) =>
          entry.status === "executed" &&
          entry.publicationStatus === "published" &&
          entry.targetUrl === row.targetUrl,
      );
      const date =
        published?.provider === "manual"
          ? published.executedAt
          : published?.updatedAt;
      const candidates =
        date && baseline
          ? await repo.candidates(actor.projectId, baseline, date)
          : [];
      return {
        ...row,
        entries,
        history,
        candidates,
        publishedAt: date ?? null,
      };
    }),
  );
}

export async function approveClaimCorrection(actor: ClaimActor, id: string) {
  await requireCorrectionReviewer(actor);
  const row = await correction(actor, id);
  const asset = row.assetId
    ? await ContentRepository.getAsset(actor.projectId, row.assetId)
    : null;
  if (
    row.kind === "owned" &&
    (!asset ||
      asset.status !== "approved" ||
      asset.approvedRevision !== asset.revision)
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "Review and approve the current Content Studio revision first.",
    );
  const fact = await claimRepository.fact(actor.projectId, row.factVersionId);
  const today = new Date().toISOString().slice(0, 10);
  if (
    !fact ||
    fact.state !== "approved" ||
    fact.effectiveFrom > today ||
    (fact.effectiveUntil && fact.effectiveUntil <= today)
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "The fact backing this correction is no longer current.",
    );
  const entry = await LedgerService.proposeChange(actor, {
    kind: "content_article_update",
    provider: "manual",
    opportunityId: row.opportunityId,
    targetUrl: row.targetUrl,
    contentAssetId: asset?.id,
    contentRevision: asset?.revision,
    proposedAction:
      row.kind === "owned"
        ? "Correct the approved factual statement on the owned page"
        : "Review and hand off the external correction message",
    afterState: row.outreachDraft ?? asset?.bodyHtml,
    idempotencyKey: `claim-correction:${row.id}:${asset?.revision ?? 1}`,
    evidence: row.beforeSnapshotId
      ? [
          {
            source: "claim_source",
            label: "Before snapshot ID",
            value: row.beforeSnapshotId,
          },
        ]
      : [],
  });
  if (entry.status === "proposed")
    await LedgerService.approveChange(actor, entry.id);
  await repo.attachLedger(row, entry.id);
  await recordClaimEvent(
    actor,
    id,
    "Approved a correction for manual implementation",
  );
  await captureClaimEvent(actor, "correction_approved");
}

export async function verifyClaimPublication(
  actor: ClaimActor,
  id: string,
  passage: string,
) {
  await requireCorrectionReviewer(actor);
  const row = await correction(actor, id);
  if (!row.ledgerId)
    throw new AppError(
      "VALIDATION_ERROR",
      "Approve the correction before verifying the page.",
    );
  const ledger = await LedgerRepository.getEntry(actor.projectId, row.ledgerId);
  if (
    !ledger ||
    ledger.status !== "approved" ||
    ledger.targetUrl !== row.targetUrl
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "The correction approval is no longer current.",
    );
  const fact = await claimRepository.fact(actor.projectId, row.factVersionId);
  const today = new Date().toISOString().slice(0, 10);
  if (
    !fact ||
    fact.state !== "approved" ||
    fact.effectiveFrom > today ||
    (fact.effectiveUntil && fact.effectiveUntil <= today) ||
    !passage.toLowerCase().includes(fact.value.toLowerCase())
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "Use the exact published passage containing the currently approved value.",
    );
  const now = new Date();
  const cutoff = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
  if ((await claimRepository.dailySnapshots(actor.projectId, cutoff)) >= 10)
    throw new AppError(
      "VALIDATION_ERROR",
      "This project reached its daily evidence fetch limit.",
    );
  const probeId = await hashClaimInput(
    `verify:${row.id}:${Math.floor(now.getTime() / 300_000)}`,
  );
  const allowed = await claimRepository.reserveSnapshot({
    id: probeId,
    projectId: actor.projectId,
    url: row.targetUrl,
    fetchedAt: now.toISOString(),
    reason: "verification_pending",
  });
  if (!allowed.length)
    throw new AppError(
      "VALIDATION_ERROR",
      "This page was checked recently. Wait five minutes before trying again.",
    );
  const snapshot = await inspectPublicEvidence(row.targetUrl, passage).catch(
    () => null,
  );
  await claimRepository.finishSnapshot(
    actor.projectId,
    probeId,
    snapshot ?? { reason: "source_unavailable" },
  );
  if (
    !snapshot ||
    !("matchingPassage" in snapshot) ||
    !snapshot.matchingPassage ||
    snapshot.finalUrl !== row.targetUrl
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "The exact passage was not verified on the target URL.",
    );
  const snapshotId = await hashClaimInput(
    JSON.stringify([row.id, ledger.id, snapshot.contentHash]),
  );
  const verified = await repo.publishVerified(
    row,
    ledger.id,
    {
      ...snapshot,
      id: snapshotId,
      projectId: actor.projectId,
      url: row.targetUrl,
      fetchedAt: new Date().toISOString(),
    },
    actor.userId,
  );
  if (!verified)
    throw new AppError(
      "VALIDATION_ERROR",
      "The approved revision changed before verification.",
    );
  await recordClaimEvent(
    actor,
    id,
    "Verified the corrected passage on the target page",
  );
  await captureClaimEvent(actor, "change_recorded");
}
