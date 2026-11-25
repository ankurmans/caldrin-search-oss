import { LedgerRepository } from "../repositories/LedgerRepository";
import {
  REVISION_MOVED_MESSAGE,
  defaultIdempotencyKey,
  refusalFor,
  statesBefore,
} from "../rules/ledger.rules";
import {
  ATTRIBUTION_NOTE,
  LedgerRefusal,
  type CollectGscResult,
  type EvidenceInput,
  type LedgerEntry,
  type LedgerEntryDetail,
  type LedgerEntryDetailWithNames,
  type LedgerEntryWithNames,
  type LedgerKind,
  type LedgerObservation,
  type LedgerScope,
  type LedgerStatus,
  type ListEntriesFilter,
  type ProposeChangeInput,
  type RecordExecutionInput,
  type RecordObservationInput,
} from "../types";
import { collectGscObservations } from "./gscObservations";
import { withPeopleNames } from "./ledgerNames";

const MAX_ERROR_LENGTH = 1000;

async function requireEntry(
  projectId: string,
  entryId: string,
): Promise<LedgerEntry> {
  const entry = await LedgerRepository.getEntry(projectId, entryId);
  if (!entry) throw new LedgerRefusal("Change not found.");
  return entry;
}

// A conditional UPDATE found no row to move. Re-read to say why: the entry may
// be in the wrong state, or (approval / execution) the content may have moved.
async function explainRefusal(
  projectId: string,
  entryId: string,
  to: LedgerStatus,
): Promise<LedgerRefusal> {
  const entry = await requireEntry(projectId, entryId);
  const wasEligible = statesBefore(to).includes(entry.status);
  return wasEligible
    ? new LedgerRefusal(REVISION_MOVED_MESSAGE)
    : refusalFor(entry.status, to);
}

async function proposeChange(
  scope: LedgerScope,
  input: ProposeChangeInput,
): Promise<LedgerEntry> {
  const { projectId } = scope;
  let contentRevision = input.contentRevision ?? null;
  if (input.contentAssetId) {
    const current = await LedgerRepository.getAssetRevision(
      projectId,
      input.contentAssetId,
    );
    if (current === null) throw new LedgerRefusal("Content not found.");
    if (contentRevision !== null && contentRevision !== current) {
      throw new LedgerRefusal(
        "That content revision is no longer the current one.",
      );
    }
    contentRevision = current;
  }

  let evidence = input.evidence ?? [];
  if (input.opportunityId) {
    const fromOpportunity = await LedgerRepository.loadOpportunityEvidence(
      projectId,
      input.opportunityId,
    );
    if (!fromOpportunity) throw new LedgerRefusal("Opportunity not found.");
    evidence = [...fromOpportunity, ...evidence];
  }

  const idempotencyKey =
    input.idempotencyKey ??
    defaultIdempotencyKey({ ...input, contentRevision });
  const { entry } = await LedgerRepository.insertProposal(
    {
      projectId,
      organizationId: scope.organizationId,
      opportunityId: input.opportunityId ?? null,
      kind: input.kind,
      provider: input.provider,
      status: "proposed",
      contentAssetId: input.contentAssetId ?? null,
      contentRevision,
      targetUrl: input.targetUrl ?? null,
      proposedAction: input.proposedAction,
      beforeState: input.beforeState ?? null,
      afterState: input.afterState ?? null,
      requestedByUserId: scope.userId,
      rollbackKind: input.rollbackKind ?? "none",
      measurementMetric: input.measurementMetric ?? null,
      measurementWindowDays: input.measurementWindowDays ?? null,
      idempotencyKey,
    },
    evidence,
  );
  return entry;
}

/**
 * Records a change that already happened outside the app and that a person
 * does not approve, such as an earned link confirmed live by fetching the
 * linking page. It starts executed and published so the scheduled readings
 * can take before/after search data for the target page. Recording it twice
 * returns the same entry.
 */
async function recordObservedChange(
  scope: LedgerScope,
  input: {
    kind: LedgerKind;
    targetUrl: string;
    proposedAction: string;
    afterState?: string | null;
    measurementMetric?: string | null;
    measurementWindowDays?: number | null;
    evidence?: EvidenceInput[];
    idempotencyKey: string;
  },
): Promise<LedgerEntry> {
  const now = new Date().toISOString();
  const { entry } = await LedgerRepository.insertProposal(
    {
      projectId: scope.projectId,
      organizationId: scope.organizationId,
      kind: input.kind,
      provider: "manual",
      status: "executed",
      publicationStatus: "published",
      targetUrl: input.targetUrl,
      proposedAction: input.proposedAction,
      afterState: input.afterState ?? null,
      requestedByUserId: scope.userId,
      executedByUserId: scope.userId,
      executedAt: now,
      rollbackKind: "none",
      measurementMetric: input.measurementMetric ?? null,
      measurementWindowDays: input.measurementWindowDays ?? null,
      idempotencyKey: input.idempotencyKey,
    },
    input.evidence ?? [],
  );
  return entry;
}

async function approveChange(
  scope: LedgerScope,
  entryId: string,
): Promise<LedgerEntry> {
  const approved = await LedgerRepository.approve(
    scope.projectId,
    entryId,
    statesBefore("approved"),
    scope.userId,
  );
  if (approved) return approved;
  throw await explainRefusal(scope.projectId, entryId, "approved");
}

async function rejectChange(
  scope: LedgerScope,
  entryId: string,
  reason: string,
): Promise<LedgerEntry> {
  const text = reason.trim();
  if (!text) throw new LedgerRefusal("A reason is needed to reject a change.");
  const rejected = await LedgerRepository.transition({
    projectId: scope.projectId,
    entryId,
    from: statesBefore("rejected"),
    to: "rejected",
    changes: {
      finalDecision: `Rejected: ${text}`,
      finalDecidedByUserId: scope.userId,
      finalDecidedAt: new Date().toISOString(),
    },
  });
  if (rejected) return rejected;
  throw await explainRefusal(scope.projectId, entryId, "rejected");
}

// Every executor calls this before touching a provider. It is the only way
// into "executing", and it holds only for an approved entry whose approved
// revision is still the content's revision.
async function beginExecution(
  scope: LedgerScope,
  entryId: string,
): Promise<LedgerEntry> {
  const entry = await LedgerRepository.beginExecution(
    scope.projectId,
    entryId,
    statesBefore("executing"),
    scope.userId,
  );
  if (entry) return entry;
  throw await explainRefusal(scope.projectId, entryId, "executing");
}

async function recordExecution(
  scope: LedgerScope,
  entryId: string,
  input: RecordExecutionInput,
): Promise<LedgerEntry> {
  const rollback = input.rollback;
  if (rollback && rollback.kind !== "none" && !rollback.payload.trim()) {
    throw new LedgerRefusal("A rollback needs a payload to restore from.");
  }
  const executed = await LedgerRepository.transition({
    projectId: scope.projectId,
    entryId,
    from: statesBefore("executed"),
    to: "executed",
    changes: {
      executedAt: new Date().toISOString(),
      executedByUserId: scope.userId,
      publicationStatus: input.publicationStatus,
      externalId: input.externalId ?? undefined,
      targetUrl: input.targetUrl ?? undefined,
      diff: input.diff ?? undefined,
      afterState: input.afterState ?? undefined,
      // The proposal's rollbackKind is a plan. Only what the executor recorded
      // counts: no recorded rollback means none is offered.
      rollbackKind: rollback?.kind ?? "none",
      rollbackPayload:
        rollback && rollback.kind !== "none" ? rollback.payload : null,
      error: null,
    },
  });
  if (executed) return executed;
  throw await explainRefusal(scope.projectId, entryId, "executed");
}

async function recordVerifiedPublication(scope: LedgerScope, entryId: string) {
  const entry = await LedgerRepository.transition({
    projectId: scope.projectId,
    entryId,
    from: ["executed"],
    to: "executed",
    changes: { publicationStatus: "published" },
  });
  if (entry) return entry;
  throw new LedgerRefusal("The executed change could not be marked published.");
}

async function recordFailure(
  scope: LedgerScope,
  entryId: string,
  error: string,
): Promise<LedgerEntry> {
  const failed = await LedgerRepository.transition({
    projectId: scope.projectId,
    entryId,
    from: statesBefore("failed"),
    to: "failed",
    changes: {
      error: error.slice(0, MAX_ERROR_LENGTH),
      publicationStatus: "failed",
    },
  });
  if (failed) return failed;
  throw await explainRefusal(scope.projectId, entryId, "failed");
}

async function beginRollback(
  scope: LedgerScope,
  entryId: string,
): Promise<{ kind: LedgerEntry["rollbackKind"]; payload: string }> {
  const entry = await requireEntry(scope.projectId, entryId);
  if (entry.status !== "executed") {
    throw new LedgerRefusal("Only an executed change can be rolled back.");
  }
  if (entry.rollbackKind === "none") {
    throw new LedgerRefusal("This change recorded no way to roll it back.");
  }
  return { kind: entry.rollbackKind, payload: entry.rollbackPayload ?? "" };
}

async function recordRollback(
  scope: LedgerScope,
  entryId: string,
): Promise<LedgerEntry> {
  // Re-checks the same gate as beginRollback so a state change in between
  // (or a caller that skipped it) cannot mark an unrollbackable entry.
  await beginRollback(scope, entryId);
  const rolledBack = await LedgerRepository.transition({
    projectId: scope.projectId,
    entryId,
    from: statesBefore("rolled_back"),
    to: "rolled_back",
    changes: {
      rolledBackAt: new Date().toISOString(),
      rolledBackByUserId: scope.userId,
    },
  });
  if (rolledBack) return rolledBack;
  throw await explainRefusal(scope.projectId, entryId, "rolled_back");
}

async function recordFinalDecision(
  scope: LedgerScope,
  entryId: string,
  text: string,
): Promise<LedgerEntry> {
  const decision = text.trim();
  if (!decision) throw new LedgerRefusal("The decision cannot be empty.");
  const entry = await LedgerRepository.setFinalDecision(
    scope.projectId,
    entryId,
    ["executed", "rolled_back"],
    decision,
    scope.userId,
  );
  if (entry) return entry;
  const current = await requireEntry(scope.projectId, entryId);
  throw new LedgerRefusal(
    `A final decision is recorded after a change was executed; this one is ${current.status.replace("_", " ")}.`,
  );
}

// Who decided, after checking by hand, that a failed change never applied.
async function recordFailureDecision(
  scope: LedgerScope,
  entryId: string,
  text: string,
): Promise<LedgerEntry> {
  const entry = await LedgerRepository.setFinalDecision(
    scope.projectId,
    entryId,
    ["failed"],
    text,
    scope.userId,
  );
  if (entry) return entry;
  throw new LedgerRefusal("Only a failed change can record this decision.");
}

async function recordObservation(
  scope: LedgerScope,
  entryId: string,
  input: RecordObservationInput,
): Promise<LedgerObservation> {
  await requireEntry(scope.projectId, entryId);
  if (!Number.isFinite(input.value)) {
    throw new LedgerRefusal("An observation needs a numeric value.");
  }
  const { numerator, denominator } = input;
  if (
    (numerator != null && !Number.isFinite(numerator)) ||
    (denominator != null && (!Number.isFinite(denominator) || denominator <= 0))
  ) {
    throw new LedgerRefusal(
      "Numerator and denominator must be numbers, and the denominator above zero.",
    );
  }
  return LedgerRepository.insertObservation(entryId, input);
}

async function collectGsc(
  scope: LedgerScope,
  entryId: string,
  now: Date = new Date(),
): Promise<CollectGscResult> {
  const entry = await requireEntry(scope.projectId, entryId);
  return collectGscObservations(scope.projectId, entry, now);
}

async function listEntries(
  projectId: string,
  filter: ListEntriesFilter = {},
): Promise<LedgerEntry[]> {
  return LedgerRepository.listEntries(projectId, filter);
}

async function getEntry(
  projectId: string,
  entryId: string,
): Promise<LedgerEntryDetail> {
  const entry = await requireEntry(projectId, entryId);
  const [evidence, observations, costs] = await Promise.all([
    LedgerRepository.listEvidence(entry.id),
    LedgerRepository.listObservations(entry.id),
    LedgerRepository.listCosts(projectId, entry.id),
  ]);
  return {
    entry,
    evidence,
    observations,
    costs,
    attribution: "observed_only",
    attributionNote: ATTRIBUTION_NOTE,
  };
}

// The screen-facing reads: the same entries with people's names resolved.
async function listEntriesWithNames(
  projectId: string,
  filter: ListEntriesFilter = {},
): Promise<LedgerEntryWithNames[]> {
  return withPeopleNames(await listEntries(projectId, filter));
}

async function getEntryWithNames(
  projectId: string,
  entryId: string,
): Promise<LedgerEntryDetailWithNames> {
  const detail = await getEntry(projectId, entryId);
  const [entry] = await withPeopleNames([detail.entry]);
  return { ...detail, entry };
}

export const LedgerService = {
  proposeChange,
  recordObservedChange,
  approveChange,
  rejectChange,
  beginExecution,
  recordExecution,
  recordVerifiedPublication,
  recordFailure,
  beginRollback,
  recordRollback,
  recordFinalDecision,
  recordFailureDecision,
  recordObservation,
  collectGscObservations: collectGsc,
  listEntries,
  getEntry,
  listEntriesWithNames,
  getEntryWithNames,
};
