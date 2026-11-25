import { countBy, sort } from "remeda";
import { AttributionLeadsRepository as leads } from "../repositories/AttributionLeadsRepository";
import { AttributionLedgerRepository as ledger } from "../repositories/AttributionLedgerRepository";
import { buildEnquiries, sumMoney, type Enquiry } from "./attributionPipeline";
import { resolveScope, type ReportQuery } from "./attributionReports";

const MAX_MISROUTED = 50;
const UNASSIGNED = "No receiving brand";
const NOT_STATED = "Not stated";

const ROUTING_NOTE =
  "A brand is the one that received the enquiry; the intended brand is the one the buyer wanted. Where they differ the enquiry is listed as misrouted and its value is shown under the intended brand, but the received brand is kept on the record. Nothing is overwritten.";

const isMisrouted = (e: Enquiry) =>
  Boolean(
    e.intendedBrandId &&
    e.firstEvent.brandId &&
    e.intendedBrandId !== e.firstEvent.brandId,
  );

/** Which brand received each enquiry, which one it was meant for, and where they differ. */
export async function getBrandRouting(query: ReportQuery) {
  const { scope, currency } = await resolveScope(query);
  const [events, brands] = await Promise.all([
    leads.pipelineEvents(scope),
    ledger.listBrands(query.projectId),
  ]);
  const subjectOf = await leads.subjectsOfEvents(
    query.projectId,
    events.map((e) => e.id),
  );
  const enquiries = buildEnquiries(events, subjectOf);
  const name = new Map(brands.map((b) => [b.id, b.name]));
  const received = (e: (typeof enquiries)[number]) =>
    e.firstEvent.brandId ? (name.get(e.firstEvent.brandId) ?? null) : null;
  const intended = (e: (typeof enquiries)[number]) =>
    e.intendedBrandId ? (name.get(e.intendedBrandId) ?? null) : null;

  const matrix = countBy(
    enquiries,
    (e) => `${received(e) ?? UNASSIGNED}\u0000${intended(e) ?? NOT_STATED}`,
  );
  const effective = new Map<string, typeof enquiries>();
  for (const e of enquiries) {
    const key = intended(e) ?? received(e) ?? UNASSIGNED;
    effective.set(key, [...(effective.get(key) ?? []), e]);
  }

  return {
    note: ROUTING_NOTE,
    reportingCurrency: currency,
    brands: brands.map((b) => ({ id: b.id, name: b.name })),
    totals: {
      enquiries: enquiries.length,
      misrouted: enquiries.filter(isMisrouted).length,
      noReceivingBrand: enquiries.filter((e) => !e.firstEvent.brandId).length,
      intendedNotStated: enquiries.filter((e) => !e.intendedBrandId).length,
    },
    matrix: Object.entries(matrix).map(([key, count]) => {
      const [receivedBrand = UNASSIGNED, intendedBrand = NOT_STATED] =
        key.split("\u0000");
      return { receivedBrand, intendedBrand, count };
    }),
    byEffectiveBrand: sort(
      [...effective.entries()].map(([brand, list]) => ({
        brand,
        enquiries: list.length,
        won: list.filter((e) => e.stage === "won").length,
        contract: sumMoney(list.map((e) => e.contract)),
        pipeline: sumMoney(list.map((e) => e.pipeline)),
      })),
      (a, b) => b.enquiries - a.enquiries,
    ),
    misrouted: enquiries
      .filter(isMisrouted)
      .slice(0, MAX_MISROUTED)
      .map((e) => ({
        conversionId: e.conversionId,
        occurredAt: e.firstEvent.occurredAt,
        receivedBrand: received(e),
        intendedBrand: intended(e),
        landingHost: e.firstEvent.landingHost,
        selfReported: e.selfReported,
        stage: e.stage,
        leadOwner: e.details.lead_owner ?? null,
        dealOwner: e.dealOwner,
        contract: e.contract,
      })),
  };
}
