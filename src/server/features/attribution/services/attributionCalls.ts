import { countBy, sort } from "remeda";
import {
  CALL_PROXY_SECONDS,
  readEnquiryPayload,
} from "@/shared/attribution/enquiry";
import { addMoney, type Money } from "@/shared/attribution/money";
import { CHANNELS, narrow } from "@/shared/attribution/vocabulary";
import { AttributionLeadsRepository as leads } from "../repositories/AttributionLeadsRepository";
import { AttributionLedgerRepository as ledger } from "../repositories/AttributionLedgerRepository";
import { AttributionReportRepository as reports } from "../repositories/AttributionReportRepository";
import { buildEnquiries } from "./attributionPipeline";
import { resolveScope, type ReportQuery } from "./attributionReports";

const BP = 10_000;
const MAX_MISSED = 25;

const CALLS_NOTE = `A call of ${CALL_PROXY_SECONDS} seconds or more is a proxy for a real conversation. It is not a qualified lead, a booked job or revenue, and none of those are inferred from it. Caller phone numbers are not stored, so a missed call cannot be matched to a later callback; follow-up is judged only from the handoff status your call system reports.`;

/** Calls by outcome and source, and how far the calls that can be tied to a person got. */
export async function getCallsReport(query: ReportQuery) {
  const { scope, model, currency } = await resolveScope(query);
  const [events, brands, rollup] = await Promise.all([
    leads.pipelineEvents(scope),
    ledger.listBrands(query.projectId),
    reports.creditRollup(scope, { model, bySource: true }),
  ]);
  const subjectOf = await leads.subjectsOfEvents(
    query.projectId,
    events.map((e) => e.id),
  );
  const calls = events
    .filter((e) => e.eventType === "call")
    .map((e) => ({ event: e, details: readEnquiryPayload(e.payload) }));
  const status = countBy(calls, (c) => c.details.call_status ?? "unspecified");
  const brandName = new Map(brands.map((b) => [b.id, b.name]));

  // Only calls that share an id with later events can be followed to an outcome.
  const callers = new Set(
    calls.flatMap((c) => {
      const subject = subjectOf.get(c.event.id);
      return subject ? [subject] : [];
    }),
  );
  const followed = buildEnquiries(events, subjectOf).filter((e) =>
    callers.has(e.subjectId),
  );
  const contract: Money[] = [];
  for (const e of followed)
    for (const m of e.contract) addMoney(contract, m.currency, m.minor);

  const bySource = new Map<
    string,
    { channel: string; source: string | null; calls: number }
  >();
  for (const r of rollup) {
    if (r.kind !== "call") continue;
    const key = `${r.channel}|${r.source ?? ""}`;
    const row = bySource.get(key) ?? {
      channel: narrow(CHANNELS, r.channel) ?? "unknown",
      source: r.source,
      calls: 0,
    };
    row.calls += r.bp / BP;
    bySource.set(key, row);
  }

  return {
    note: CALLS_NOTE,
    reportingCurrency: currency,
    proxySeconds: CALL_PROXY_SECONDS,
    totals: {
      calls: calls.length,
      answered: status.answered ?? 0,
      missed: status.missed ?? 0,
      voicemail: status.voicemail ?? 0,
      abandoned: status.abandoned ?? 0,
      statusUnknown: status.unspecified ?? 0,
      /** Answered calls of at least the proxy length. A proxy, not a qualified lead. */
      conversationProxy: calls.filter(
        (c) =>
          c.details.call_status === "answered" &&
          (c.details.duration_seconds ?? 0) >= CALL_PROXY_SECONDS,
      ).length,
      handoffFailed: calls.filter((c) => c.details.handoff === "failed").length,
      handoffCompleted: calls.filter((c) => c.details.handoff === "completed")
        .length,
    },
    tiedToOutcomes: {
      callers: followed.length,
      byStage: countBy(followed, (e) => e.stage),
      contract,
    },
    bySource: sort([...bySource.values()], (a, b) => b.calls - a.calls),
    needsFollowUp: calls
      .filter(
        (c) =>
          c.details.call_status === "missed" ||
          c.details.call_status === "abandoned" ||
          c.details.handoff === "failed",
      )
      .slice(-MAX_MISSED)
      .map((c) => ({
        occurredAt: c.event.occurredAt,
        status: c.details.call_status ?? null,
        handoff: c.details.handoff ?? null,
        brand: c.event.brandId
          ? (brandName.get(c.event.brandId) ?? null)
          : null,
        source: c.event.utmSource ?? c.event.referrerHost ?? null,
      })),
  };
}
