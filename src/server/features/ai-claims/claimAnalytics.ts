import { captureServerEvent } from "@/server/lib/posthog";

type ClaimEvent =
  | "analysis_started"
  | "analysis_finished"
  | "claim_reviewed"
  | "fact_approved"
  | "evidence_inspected"
  | "opportunity_created"
  | "content_drafted"
  | "correction_approved"
  | "change_recorded"
  | "verification_started"
  | "verification_reading_recorded";

export function captureClaimEvent(
  actor: { userId: string; organizationId: string },
  event: ClaimEvent,
  outcome?:
    | "completed"
    | "partial"
    | "failed"
    | "cancelled"
    | "conflict_persists"
    | "matches_fact"
    | "not_found_in_extraction"
    | "inconclusive",
) {
  return captureServerEvent({
    distinctId: actor.userId,
    organizationId: actor.organizationId,
    event: `claims:${event}`,
    properties: outcome ? { outcome } : undefined,
  });
}
