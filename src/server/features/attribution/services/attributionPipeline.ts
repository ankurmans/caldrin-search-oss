import { sort } from "remeda";
import {
  readEnquiryPayload,
  type EnquiryDetails,
} from "@/shared/attribution/enquiry";
import { addMoney, type Money } from "@/shared/attribution/money";
import type { AttributionLeadsRepository } from "../repositories/AttributionLeadsRepository";

export type PipelineEvent = Awaited<
  ReturnType<typeof AttributionLeadsRepository.pipelineEvents>
>[number];

export type PipelineStage = "enquiry" | "qualified" | "booked" | "won" | "lost";

const OPEN_RANK = { enquiry: 1, qualified: 2, booked: 3 } as const;

const ENQUIRY_TYPES = new Set(["lead", "call"]);

export type Enquiry = {
  /** The identity group the events resolved to, or the event itself when it had none. */
  subjectId: string;
  stage: PipelineStage;
  firstEvent: PipelineEvent;
  details: EnquiryDetails;
  leadEvents: number;
  /** A brand named on any event of the subject as the one the work was meant for. */
  intendedBrandId: string | null;
  dealOwner: string | null;
  /** The buyer's own words for how they found you, exactly as recorded. */
  selfReported: string | null;
  contract: Money[];
  collected: Money[];
  /** Estimated value on an enquiry that is still open. Not revenue. */
  pipeline: Money[];
  conversionId: string | null;
};

const money = (list: Money[], event: PipelineEvent, minor: number | null) => {
  if (minor != null && event.currency) addMoney(list, event.currency, minor);
};

/**
 * Groups pipeline events into one enquiry per subject and reads how far each
 * got. Won contract value, collected cash and open pipeline value are kept in
 * separate lists and never added together.
 */
export function buildEnquiries(
  events: PipelineEvent[],
  subjectOf: Map<string, string>,
): Enquiry[] {
  const bySubject = new Map<string, PipelineEvent[]>();
  for (const e of events) {
    const subject = subjectOf.get(e.id) ?? `event:${e.id}`;
    const list = bySubject.get(subject) ?? [];
    list.push(e);
    bySubject.set(subject, list);
  }
  const enquiries: Enquiry[] = [];
  for (const [subjectId, list] of bySubject) {
    const first = list.find((e) => e.eventType !== "payment");
    // Cash from someone with no recorded enquiry is not part of this pipeline.
    if (!first) continue;
    let open: keyof typeof OPEN_RANK = "enquiry";
    let decision: "won" | "lost" | null = null;
    const contract: Money[] = [];
    const collected: Money[] = [];
    const pipeline: Money[] = [];
    let latestEstimate: PipelineEvent | null = null;
    let leadEvents = 0;
    let dealOwner: string | null = null;
    let selfReported: string | null = null;
    let details: EnquiryDetails = {};
    let intendedBrandId: string | null = null;
    for (const e of list) {
      const d = readEnquiryPayload(e.payload);
      if (e === first) details = d;
      dealOwner = d.deal_owner ?? dealOwner;
      selfReported = selfReported ?? e.selfReportedSource;
      intendedBrandId = e.intendedBrandId ?? intendedBrandId;
      if (e.eventType === "lead") leadEvents += 1;
      if (
        e.eventType === "qualified_lead" &&
        OPEN_RANK[open] < OPEN_RANK.qualified
      )
        open = "qualified";
      if (e.eventType === "booking") open = "booked";
      if (e.eventType === "deal_won") {
        decision = "won";
        money(contract, e, e.amountMinor);
      }
      if (e.eventType === "deal_lost") decision = "lost";
      if (e.eventType === "payment") money(collected, e, e.collectedMinor);
      if (e.eventType !== "payment" && e.amountMinor != null)
        latestEstimate = e;
    }
    // Won after lost reopens the deal; the last decision stands.
    const stage: PipelineStage = decision ?? open;
    if (!decision && latestEstimate)
      money(pipeline, latestEstimate, latestEstimate.amountMinor);
    enquiries.push({
      subjectId,
      stage,
      firstEvent: first,
      details,
      leadEvents,
      intendedBrandId,
      dealOwner,
      selfReported,
      contract,
      collected,
      pipeline,
      conversionId:
        list.find((e) => ENQUIRY_TYPES.has(e.eventType))?.conversionId ?? null,
    });
  }
  return sort(enquiries, (a, b) =>
    b.firstEvent.occurredAt.localeCompare(a.firstEvent.occurredAt),
  );
}

export const sumMoney = (lists: Money[][]) => {
  const out: Money[] = [];
  for (const list of lists)
    for (const m of list) addMoney(out, m.currency, m.minor);
  return out;
};
