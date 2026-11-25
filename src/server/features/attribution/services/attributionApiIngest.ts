import { looksLikeBot, normalizeHost } from "@/shared/attribution/channels";
import { enquiryPayload } from "@/shared/attribution/enquiry";
import { parseLanding, parseReferrer } from "@/shared/attribution/urls";
import type { IdentifierType } from "@/shared/attribution/vocabulary";
import type { BrowserEvent, ServerEvent } from "@/types/schemas/attribution";
import { sha256Hex } from "@/server/lib/audit/ids";
import { AttributionLedgerRepository as ledger } from "../repositories/AttributionLedgerRepository";
import {
  ingestNormalized,
  type IngestResult,
  type NormalizedEvent,
  type Rejection,
} from "./attributionIngest";

const FUTURE_SKEW_MS = 5 * 60 * 1000;
const BROWSER_MAX_AGE_MS = 72 * 60 * 60 * 1000;

/**
 * Events from the tracker snippet in a visitor's browser. Only hosts the
 * project registered are accepted, a browser that asks not to be tracked is
 * not recorded, and the visitor's clock is trusted only within a window.
 */
export async function ingestBrowserEvents(
  projectId: string,
  request: {
    events: BrowserEvent[];
    userAgent: string | null;
    doNotTrack: boolean;
  },
): Promise<IngestResult> {
  if (request.doNotTrack)
    return {
      accepted: 0,
      duplicate: 0,
      rejected: request.events.length,
      rejections: [{ reason: "do_not_track" }],
    };
  const properties = await ledger.listProperties(projectId);
  const byHost = new Map(properties.map((p) => [normalizeHost(p.host), p]));
  const isBot = looksLikeBot(request.userAgent);
  const now = Date.now();
  const rejections: Rejection[] = [];
  const events: NormalizedEvent[] = [];
  let verifiedProperty: string | null = null;

  for (const e of request.events) {
    // The browser key is public, so it cannot vouch for who someone is or what they did.
    if (e.type !== "page_view" && e.type !== "session_start") {
      rejections.push({ reason: "secret_key_required", detail: e.type });
      continue;
    }
    const page = parseLanding(e.url);
    const property = byHost.get(page.host);
    if (!property) {
      rejections.push({
        reason: "unregistered_host",
        detail: page.host ?? "no url",
      });
      continue;
    }
    const skewed =
      e.t === undefined ||
      e.t > now + FUTURE_SKEW_MS ||
      e.t < now - BROWSER_MAX_AGE_MS;
    const ref = parseReferrer(e.ref);
    const isSession = e.type === "session_start";
    events.push({
      sourceSystem: "tracker",
      sourceEventId: e.id,
      origin: "browser",
      eventType: e.type,
      occurredAt: new Date(skewed ? now : (e.t ?? now)).toISOString(),
      identifiers: [{ type: "visitor", value: e.vid }],
      propertyId: property.id,
      brandId: property.brandId,
      sessionId: e.sid ?? null,
      landingHost: isSession ? page.host : null,
      landingPath: isSession ? page.path : null,
      pagePath: page.path,
      referrerHost: isSession ? ref.host : null,
      referrerPath: isSession ? ref.path : null,
      utmSource: isSession ? page.utmSource : null,
      utmMedium: isSession ? page.utmMedium : null,
      utmCampaign: isSession ? page.utmCampaign : null,
      utmTerm: isSession ? page.utmTerm : null,
      utmContent: isSession ? page.utmContent : null,
      clickIdKind: isSession ? page.clickIdKind : null,
      clickId: isSession ? page.clickId : null,
      isTest: e.test ?? false,
      isBot,
    });
    if (!e.test && !isBot) verifiedProperty = property.id;
  }
  const result = await ingestNormalized(
    projectId,
    { sourceSystem: "tracker", label: "Tracker snippet" },
    events,
    rejections,
  );
  const at = new Date().toISOString();
  for (const p of properties)
    if (events.some((e) => e.propertyId === p.id))
      await ledger.markPropertyEvent(p.id, at, p.id === verifiedProperty);
  return result;
}

/** A deterministic id for a server event that did not bring its own. */
async function autoEventId(e: ServerEvent) {
  return `auto:${(await sha256Hex(JSON.stringify([e.type, e.occurred_at, e.visitor_id, e.user_id, e.customer_id, e.lead_id, e.order_id, e.deal_id, e.amount_minor, e.currency]))).slice(0, 24)}`;
}

/**
 * Events from the customer's own backend, sent with a secret key. These are
 * the authoritative record of a signup, a payment or a won deal.
 */
export async function ingestServerEvents(
  projectId: string,
  events: ServerEvent[],
  batch: { sourceSystem?: string; label?: string; isDemo?: boolean } = {},
): Promise<IngestResult> {
  const [properties, brands] = await Promise.all([
    ledger.listProperties(projectId),
    ledger.listBrands(projectId),
  ]);
  const rejections: Rejection[] = [];
  const out: NormalizedEvent[] = [];
  const brandOf = (name: string | undefined) =>
    name
      ? brands.find(
          (b) =>
            b.slug === name.toLowerCase() ||
            b.name.toLowerCase() === name.toLowerCase(),
        )
      : undefined;
  for (const e of events) {
    const brand = brandOf(e.brand);
    const intended = brandOf(e.intended_brand);
    if ((e.brand && !brand) || (e.intended_brand && !intended)) {
      rejections.push({
        reason: "unknown_brand",
        detail: e.brand ?? e.intended_brand,
      });
      continue;
    }
    const property = e.property
      ? properties.find((p) => p.host === normalizeHost(e.property))
      : undefined;
    const landing = parseLanding(e.url);
    const ref = parseReferrer(e.referrer);
    const identifiers: NormalizedEvent["identifiers"] = [];
    const add = (type: IdentifierType, value: string | undefined) => {
      if (value) identifiers.push({ type, value });
    };
    add("visitor", e.visitor_id);
    add("user", e.user_id);
    add("customer", e.customer_id);
    add("contact", e.contact_id);
    add("lead", e.lead_id);
    add("order", e.order_id);
    add("account", e.account_id);
    add("deal", e.deal_id);
    out.push({
      sourceSystem: batch.sourceSystem ?? "server_api",
      sourceEventId: e.event_id ?? (await autoEventId(e)),
      origin: "server",
      eventType: e.type,
      occurredAt: e.occurred_at
        ? new Date(e.occurred_at).toISOString()
        : new Date().toISOString(),
      identifiers,
      propertyId: property?.id ?? null,
      brandId: brand?.id ?? property?.brandId ?? null,
      intendedBrandId: intended?.id ?? null,
      sessionId: e.session_id ?? null,
      landingHost: landing.host,
      landingPath: landing.path,
      referrerHost: ref.host,
      referrerPath: ref.path,
      utmSource: e.utm_source ?? landing.utmSource,
      utmMedium: e.utm_medium ?? landing.utmMedium,
      utmCampaign: e.utm_campaign ?? landing.utmCampaign,
      utmTerm: landing.utmTerm,
      utmContent: landing.utmContent,
      clickIdKind: landing.clickIdKind,
      clickId: landing.clickId,
      selfReportedSource: e.self_reported_source ?? null,
      stage: e.stage ?? null,
      amountMinor: e.amount_minor ?? null,
      currency: e.currency ?? null,
      parentSourceEventId: e.parent_event_id ?? null,
      rawPayload: enquiryPayload(e),
      isTest: e.test ?? false,
    });
  }
  return ingestNormalized(
    projectId,
    {
      sourceSystem: batch.sourceSystem ?? "server_api",
      label: batch.label ?? "Server events",
      isDemo: batch.isDemo,
    },
    out,
    rejections,
  );
}
