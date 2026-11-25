import { LedgerRefusal } from "../types";
import type { LedgerKind, LedgerStatus } from "../types";

// Allowed status moves. A failed change goes back through approval, never
// straight to execution, so a retry is always a person's decision again.
const TRANSITIONS: ReadonlyArray<readonly [LedgerStatus, LedgerStatus[]]> = [
  ["proposed", ["approved", "rejected"]],
  ["approved", ["executing", "rejected"]],
  ["executing", ["executed", "failed"]],
  ["executed", ["rolled_back"]],
  ["failed", ["approved"]],
];

export function statesBefore(to: LedgerStatus): LedgerStatus[] {
  return TRANSITIONS.filter(([, targets]) => targets.includes(to)).map(
    ([from]) => from,
  );
}

const ACTION_LABEL: Record<string, string> = {
  approved: "approved",
  rejected: "rejected",
  executing: "executed",
  executed: "recorded as executed",
  failed: "recorded as failed",
  rolled_back: "rolled back",
};

// Why a move was refused, written for the person who asked for it.
export function refusalFor(
  current: LedgerStatus,
  to: LedgerStatus,
): LedgerRefusal {
  const action = ACTION_LABEL[to] ?? to;
  if (to === "executing" && current === "executing") {
    return new LedgerRefusal("This change is already executing.");
  }
  if (to === "executing") {
    return new LedgerRefusal(
      `This change cannot be executed: it is ${current.replace("_", " ")} and needs an approval first.`,
    );
  }
  return new LedgerRefusal(
    `This change cannot be ${action}: it is ${current.replace("_", " ")}.`,
  );
}

export const REVISION_MOVED_MESSAGE =
  "The content changed after it was approved. Review the new revision and approve it again.";

export function defaultIdempotencyKey(input: {
  kind: LedgerKind;
  contentAssetId?: string | null;
  contentRevision?: number | null;
  opportunityId?: string | null;
  targetUrl?: string | null;
  proposedAction: string;
}): string {
  // Changes without an asset (technical fixes, experiments) are told apart by
  // what they are about, so two fixes on different pages are not one change.
  const subject =
    input.contentAssetId ??
    (input.opportunityId ? `opp:${input.opportunityId}` : null) ??
    (input.targetUrl ? `url:${input.targetUrl}` : null) ??
    `action:${input.proposedAction}`;
  return `${input.kind}:${subject}:${input.contentRevision ?? 0}`;
}
