import { countBy, sort } from "remeda";
import { classifySelfReported } from "@/shared/attribution/selfReported";
import { addMoney, type Money } from "@/shared/attribution/money";
import {
  CHANNELS,
  narrow,
  type Channel,
} from "@/shared/attribution/vocabulary";
import { AttributionLeadsRepository as leads } from "../repositories/AttributionLeadsRepository";
import { AttributionLedgerRepository as ledger } from "../repositories/AttributionLedgerRepository";
import { AttributionReportRepository as reports } from "../repositories/AttributionReportRepository";
import { buildEnquiries, sumMoney, type Enquiry } from "./attributionPipeline";
import { resolveScope, type ReportQuery } from "./attributionReports";

const BP = 10_000;
const MAX_RECENT = 40;
const MAX_PHRASES = 25;

const ENQUIRY_KINDS = new Set(["lead", "call"]);

const LEADS_NOTE =
  "Won contract value, collected cash and open pipeline value are different things and are never added together. Recognised revenue is not computed: it needs a delivery schedule this ledger does not hold. People are joined only by ids the source systems send together, never by email or name, so a person who enquired twice under different ids counts twice. The source table credits every lead record, so an enquiry recorded twice under one id counts twice there but once in the totals.";

/** Where enquiries ended up, what they were worth, and what buyers said in their own words. */
export async function getLeadsReport(query: ReportQuery) {
  const { scope, model, currency } = await resolveScope(query);
  const [events, brands, rollup, pending] = await Promise.all([
    leads.pipelineEvents(scope),
    ledger.listBrands(query.projectId),
    reports.creditRollup(scope, { model, bySource: true }),
    ledger.countPending(query.projectId),
  ]);
  const subjectOf = await leads.subjectsOfEvents(
    query.projectId,
    events.map((e) => e.id),
  );
  const enquiries = buildEnquiries(events, subjectOf);
  const brandName = new Map(brands.map((b) => [b.id, b.name]));
  const stages = countBy(enquiries, (e) => e.stage);

  const sources = new Map<
    string,
    {
      channel: Channel;
      source: string | null;
      enquiries: number;
      qualified: number;
      won: number;
      wonValue: Money[];
      evidenceBp: Record<string, number>;
    }
  >();
  let unknownBp = 0;
  let enquiryBp = 0;
  for (const r of rollup) {
    const isEnquiry = ENQUIRY_KINDS.has(r.kind);
    if (!isEnquiry && r.kind !== "qualified_lead" && r.kind !== "deal_won")
      continue;
    const channel = narrow(CHANNELS, r.channel) ?? "unknown";
    const key = `${channel}|${r.source ?? ""}`;
    const row = sources.get(key) ?? {
      channel,
      source: r.source,
      enquiries: 0,
      qualified: 0,
      won: 0,
      wonValue: [],
      evidenceBp: {},
    };
    if (isEnquiry) {
      row.enquiries += r.bp / BP;
      row.evidenceBp[r.evidence] = (row.evidenceBp[r.evidence] ?? 0) + r.bp;
      enquiryBp += r.bp;
      if (channel === "unknown") unknownBp += r.bp;
    } else if (r.kind === "qualified_lead") row.qualified += r.bp / BP;
    else {
      row.won += r.bp / BP;
      addMoney(row.wonValue, r.currency, Math.round(r.weighted / BP));
    }
    sources.set(key, row);
  }

  const phrases = new Map<string, { text: string; count: number }>();
  for (const e of enquiries) {
    if (!e.selfReported) continue;
    const key = e.selfReported.trim().toLowerCase();
    const row = phrases.get(key) ?? { text: e.selfReported.trim(), count: 0 };
    row.count += 1;
    phrases.set(key, row);
  }

  const recent = enquiries
    .slice(0, MAX_RECENT)
    .map((e) => describe(e, brandName));

  return {
    model,
    reportingCurrency: currency,
    demo: query.demo,
    note: LEADS_NOTE,
    /** Recorded events not yet joined to people and sources; the figures below are incomplete until it is zero. */
    pendingEvents: pending,
    totals: {
      enquiries: enquiries.length,
      byStage: {
        enquiry: stages.enquiry ?? 0,
        qualified: stages.qualified ?? 0,
        booked: stages.booked ?? 0,
        won: stages.won ?? 0,
        lost: stages.lost ?? 0,
      },
      /** Enquiries whose buyer gave no words about how they found you. */
      withoutOwnWords: enquiries.filter((e) => !e.selfReported).length,
      duplicateSubjects: enquiries.filter((e) => e.leadEvents > 1).length,
      extraLeadRecords: enquiries.reduce(
        (n, e) => n + Math.max(0, e.leadEvents - 1),
        0,
      ),
    },
    value: {
      contract: sumMoney(enquiries.map((e) => e.contract)),
      collected: sumMoney(enquiries.map((e) => e.collected)),
      pipeline: sumMoney(enquiries.map((e) => e.pipeline)),
    },
    byEnquiryChannel: countBy(
      enquiries,
      (e) => e.details.enquiry_channel ?? "unspecified",
    ),
    bySource: sort(
      [...sources.values()],
      (a, b) => b.enquiries - a.enquiries || b.won - a.won,
    ).slice(0, 25),
    /** Share of credited enquiries with no recorded source, in basis points. */
    unknownBp: enquiryBp === 0 ? 0 : Math.round((unknownBp / enquiryBp) * BP),
    selfReported: sort(
      [...phrases.values()].map((p) => ({
        ...p,
        read: classifySelfReported(p.text),
      })),
      (a, b) => b.count - a.count,
    ).slice(0, MAX_PHRASES),
    recent,
  };
}

function describe(e: Enquiry, brandName: Map<string, string>) {
  const received = e.firstEvent.brandId;
  return {
    conversionId: e.conversionId,
    occurredAt: e.firstEvent.occurredAt,
    stage: e.stage,
    enquiryChannel: e.details.enquiry_channel ?? null,
    receivedBrand: received ? (brandName.get(received) ?? null) : null,
    intendedBrand: e.intendedBrandId
      ? (brandName.get(e.intendedBrandId) ?? null)
      : null,
    landingHost: e.firstEvent.landingHost,
    selfReported: e.selfReported,
    leadOwner: e.details.lead_owner ?? null,
    dealOwner: e.dealOwner,
    contract: e.contract,
    pipeline: e.pipeline,
    leadRecords: e.leadEvents,
  };
}
