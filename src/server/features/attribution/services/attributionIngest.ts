import { env } from "cloudflare:workers";
import type {
  EventType,
  IdentifierType,
  Origin,
} from "@/shared/attribution/vocabulary";
import { sha256Hex } from "@/server/lib/audit/ids";
import {
  AttributionLedgerRepository as ledger,
  type NewEvent,
} from "../repositories/AttributionLedgerRepository";
import { drainAttribution } from "./attributionDrain";

const INLINE_DRAIN_BUDGET = 100;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const PAYLOAD_INLINE_MAX = 2000;
const DEFAULT_DAILY_LIMIT = 200_000;
// Anyone can send with the public tracker key, so it may not use the whole
// day's budget: the rest stays free for server events and signed webhooks.
const TRACKER_SHARE = 0.8;

export type NormalizedEvent = {
  sourceSystem: string;
  sourceEventId: string;
  origin: Origin;
  eventType: EventType;
  occurredAt: string;
  identifiers: { type: IdentifierType; value: string }[];
  propertyId?: string | null;
  brandId?: string | null;
  intendedBrandId?: string | null;
  sessionId?: string | null;
  landingHost?: string | null;
  landingPath?: string | null;
  pagePath?: string | null;
  referrerHost?: string | null;
  referrerPath?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  clickIdKind?: string | null;
  clickId?: string | null;
  selfReportedSource?: string | null;
  stage?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  parentSourceEventId?: string | null;
  /** The source's own record, kept as evidence. */
  rawPayload?: string | null;
  isTest?: boolean;
  isBot?: boolean;
};

export type Rejection = { reason: string; detail?: string };
export type IngestResult = {
  accepted: number;
  duplicate: number;
  rejected: number;
  rejections: Rejection[];
};

const shortId = async (...parts: string[]) =>
  (await sha256Hex(parts.join("|"))).slice(0, 36);

/** Small payloads stay in the row; larger ones go to R2 when it is bound. */
async function storePayload(
  projectId: string,
  eventId: string,
  raw: string | null | undefined,
) {
  if (!raw) return { payload: null, payloadKey: null };
  if (raw.length <= PAYLOAD_INLINE_MAX)
    return { payload: raw, payloadKey: null };
  const key = `attribution/${projectId}/${eventId}.json`;
  try {
    await env.R2.put(key, raw, {
      httpMetadata: { contentType: "application/json" },
    });
    return { payload: raw.slice(0, 200), payloadKey: key };
  } catch {
    return { payload: raw.slice(0, PAYLOAD_INLINE_MAX), payloadKey: null };
  }
}

async function toRow(
  projectId: string,
  batchId: string,
  ingestedAt: string,
  e: NormalizedEvent,
) {
  const id = await shortId(projectId, e.sourceSystem, e.sourceEventId);
  const stored = await storePayload(projectId, id, e.rawPayload);
  const event: NewEvent = {
    id,
    projectId,
    propertyId: e.propertyId ?? null,
    brandId: e.brandId ?? null,
    intendedBrandId: e.intendedBrandId ?? null,
    eventType: e.eventType,
    sourceSystem: e.sourceSystem,
    sourceEventId: e.sourceEventId,
    origin: e.origin,
    occurredAt: e.occurredAt,
    ingestedAt,
    importBatchId: batchId,
    sessionId: e.sessionId ?? null,
    landingHost: e.landingHost ?? null,
    landingPath: e.landingPath ?? null,
    pagePath: e.pagePath ?? null,
    referrerHost: e.referrerHost ?? null,
    referrerPath: e.referrerPath ?? null,
    utmSource: e.utmSource ?? null,
    utmMedium: e.utmMedium ?? null,
    utmCampaign: e.utmCampaign ?? null,
    utmTerm: e.utmTerm ?? null,
    utmContent: e.utmContent ?? null,
    clickIdKind: e.clickIdKind ?? null,
    clickId: e.clickId ?? null,
    selfReportedSource: e.selfReportedSource ?? null,
    stage: e.stage ?? null,
    amountMinor: e.amountMinor ?? null,
    currency: e.currency ?? null,
    parentSourceEventId: e.parentSourceEventId ?? null,
    payload: stored.payload,
    payloadKey: stored.payloadKey,
    isTest: e.isTest ?? false,
    isBot: e.isBot ?? false,
  };
  return {
    event,
    identifiers: e.identifiers.map((i) => ({
      identifierType: i.type,
      value: i.value,
    })),
  };
}

/**
 * Writes already-validated events into the ledger. An event whose source id
 * was seen before is counted as a duplicate and changes nothing, so a webhook
 * or file delivered twice lands once. Accepted events are then turned into
 * touchpoints, conversions and credits, up to a budget; a larger import keeps
 * the rest queued for the next drain.
 */
export async function ingestNormalized(
  projectId: string,
  batch: {
    sourceSystem: string;
    label: string;
    isDemo?: boolean;
    batchId?: string;
  },
  events: NormalizedEvent[],
  rejectedBefore: Rejection[] = [],
): Promise<IngestResult & { batchId: string }> {
  const now = new Date();
  const ingestedAt = now.toISOString();
  const day = ingestedAt.slice(0, 10);
  const batchId = batch.batchId ?? crypto.randomUUID();
  await ledger.insertBatch({
    id: batchId,
    projectId,
    sourceSystem: batch.sourceSystem,
    label: batch.label,
    isDemo: batch.isDemo ?? false,
    createdAt: ingestedAt,
  });

  const rejections = [...rejectedBefore];
  const bySource = new Map<string, NormalizedEvent>();
  let duplicate = 0;
  for (const e of events) {
    if (Date.parse(e.occurredAt) > now.getTime() + FUTURE_SKEW_MS) {
      rejections.push({
        reason: "timestamp_in_future",
        detail: e.sourceEventId,
      });
      continue;
    }
    const key = `${e.sourceSystem}|${e.sourceEventId}`;
    if (bySource.has(key)) duplicate += 1;
    else bySource.set(key, e);
  }

  const settings = await ledger.getSettings(projectId);
  const used = await ledger.getCounter(projectId, day);
  const limit = settings?.dailyEventLimit ?? DEFAULT_DAILY_LIMIT;
  let room =
    (batch.sourceSystem === "tracker"
      ? Math.floor(limit * TRACKER_SHARE)
      : limit) - (used?.accepted ?? 0);

  const rows: {
    event: NewEvent;
    identifiers: { identifierType: string; value: string }[];
  }[] = [];
  const fresh: NormalizedEvent[] = [];
  const systems = new Set([...bySource.values()].map((e) => e.sourceSystem));
  for (const system of systems) {
    const incoming = [...bySource.values()].filter(
      (e) => e.sourceSystem === system,
    );
    const seen = await ledger.findExistingSourceIds(
      projectId,
      system,
      incoming.map((e) => e.sourceEventId),
    );
    for (const e of incoming) {
      if (seen.has(e.sourceEventId)) duplicate += 1;
      else fresh.push(e);
    }
  }
  for (const e of fresh) {
    if (room <= 0) {
      rejections.push({ reason: "daily_limit", detail: e.sourceEventId });
      continue;
    }
    room -= 1;
    rows.push(await toRow(projectId, batchId, ingestedAt, e));
  }
  await ledger.insertEvents(rows);
  await ledger.addCounters(projectId, day, {
    accepted: rows.length,
    rejected: rejections.length,
  });
  await ledger.addBatchCounts(batchId, {
    accepted: rows.length,
    duplicate,
    rejected: rejections.length,
  });
  if (rejections.length)
    await ledger.insertRejections(
      rejections.slice(0, 50).map((r) => ({
        id: crypto.randomUUID(),
        projectId,
        importBatchId: batchId,
        sourceSystem: batch.sourceSystem,
        reason: r.reason,
        detail: r.detail?.slice(0, 200) ?? null,
        createdAt: ingestedAt,
      })),
    );
  if (rows.length) await drainAttribution(projectId, INLINE_DRAIN_BUDGET);
  return {
    accepted: rows.length,
    duplicate,
    rejected: rejections.length,
    rejections,
    batchId,
  };
}
