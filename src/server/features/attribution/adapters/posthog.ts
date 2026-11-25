import { mapToObj } from "remeda";
import { looksLikeBot, normalizeHost } from "@/shared/attribution/channels";
import { parseLanding, parseReferrer } from "@/shared/attribution/urls";
import type { NormalizedEvent } from "../services/attributionIngest";

export const POSTHOG_SOURCE = "posthog";

/** The properties read from each PostHog event, in the order the query selects them. */
const POSTHOG_COLUMNS = [
  "uuid",
  "event",
  "unix_seconds",
  "distinct_id",
  "session_id",
  "current_url",
  "referrer",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "anon_distinct_id",
  "user_agent",
] as const;

type Column = (typeof POSTHOG_COLUMNS)[number];
type Row = Record<Column, string | number | null>;

/**
 * The HogQL query for one import. Only page views and identify calls are read,
 * oldest first, and one row more than the budget so a cut-off is detectable.
 * The bounds are integers, so nothing from a user is put in the query text.
 */
export function posthogQuery(
  fromSeconds: number,
  toSeconds: number,
  limit: number,
) {
  return `SELECT toString(uuid), event, toUnixTimestamp(timestamp), distinct_id,
  properties.$session_id, properties.$current_url, properties.$referrer,
  properties.utm_source, properties.utm_medium, properties.utm_campaign,
  properties.utm_term, properties.utm_content,
  properties.$anon_distinct_id, properties.$raw_user_agent
FROM events
WHERE event IN ('$pageview', '$identify')
  AND timestamp >= fromUnixTimestamp(${Math.trunc(fromSeconds)})
  AND timestamp < fromUnixTimestamp(${Math.trunc(toSeconds)})
ORDER BY timestamp ASC, uuid ASC
LIMIT ${Math.trunc(limit) + 1}`;
}

const text = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

function toRow(raw: unknown): Row | null {
  if (!Array.isArray(raw) || raw.length < POSTHOG_COLUMNS.length) return null;
  return mapToObj(POSTHOG_COLUMNS, (column, i) => {
    const value: unknown = raw[i];
    return [
      column,
      typeof value === "string" || typeof value === "number" ? value : null,
    ];
  });
}

type PosthogSummary = {
  pageViews: number;
  identifies: number;
  /** Sessions whose first view in the range carried a source (a referrer, campaign tags or a click id). */
  sessionsWithSource: number;
  /** Sessions with nothing recorded about where they came from; kept as plain page views, never as a touch. */
  sessionsWithoutSource: number;
  /** Rows that were not from a registered website, by host. */
  unregistered: Record<string, number>;
  skipped: number;
};

/**
 * Maps PostHog rows to ledger events. A page view carries a visitor id (its
 * distinct id). Identity is joined only by an identify call, which names the
 * anonymous id and the identified id together. The first view of a session is
 * a touch only when PostHog recorded where it came from; with nothing
 * recorded it stays a page view, so the outcome keeps an Unknown source
 * instead of becoming Direct. A missing referrer is not the same as `$direct`.
 */
export function normalizePosthogRows(
  rawRows: unknown[],
  hosts: Map<string, { id: string; brandId: string | null }>,
) {
  const events: NormalizedEvent[] = [];
  const summary: PosthogSummary = {
    pageViews: 0,
    identifies: 0,
    sessionsWithSource: 0,
    sessionsWithoutSource: 0,
    unregistered: {},
    skipped: 0,
  };
  const startedSessions = new Set<string>();

  for (const raw of rawRows) {
    const row = toRow(raw);
    const uuid = text(row?.uuid, 64);
    const distinctId = text(row?.distinct_id, 200);
    const seconds = Number(row?.unix_seconds);
    if (!row || !uuid || !distinctId || !Number.isFinite(seconds)) {
      summary.skipped += 1;
      continue;
    }
    const occurredAt = new Date(seconds * 1000).toISOString();
    const userAgent = text(row.user_agent, 300);

    if (row.event === "$identify") {
      const anon = text(row.anon_distinct_id, 200);
      if (!anon || anon === distinctId) {
        summary.skipped += 1;
        continue;
      }
      summary.identifies += 1;
      events.push({
        sourceSystem: POSTHOG_SOURCE,
        sourceEventId: `identify:${anon}:${distinctId}`,
        origin: "import",
        eventType: "identify",
        occurredAt,
        identifiers: [
          { type: "visitor", value: anon },
          { type: "visitor", value: distinctId },
          { type: "user", value: distinctId },
        ],
        isBot: looksLikeBot(userAgent),
      });
      continue;
    }

    const page = parseLanding(text(row.current_url, 2000));
    const property = page.host ? hosts.get(page.host) : undefined;
    if (!property) {
      const key = page.host ?? "no url";
      summary.unregistered[key] = (summary.unregistered[key] ?? 0) + 1;
      continue;
    }
    summary.pageViews += 1;

    const sessionId = text(row.session_id, 100);
    const referrerValue = text(row.referrer, 2000);
    const ref = parseReferrer(
      referrerValue && referrerValue !== "$direct" ? referrerValue : null,
    );
    const utmSource = page.utmSource ?? text(row.utm_source, 100);
    const utmMedium = page.utmMedium ?? text(row.utm_medium, 100);
    const hasSource =
      referrerValue !== null || !!utmSource || !!utmMedium || !!page.clickId;

    const startsSession =
      !!sessionId && !startedSessions.has(sessionId) && hasSource;
    if (sessionId && !startedSessions.has(sessionId)) {
      startedSessions.add(sessionId);
      if (hasSource) summary.sessionsWithSource += 1;
      else summary.sessionsWithoutSource += 1;
    }

    const common = {
      sourceSystem: POSTHOG_SOURCE,
      origin: "import" as const,
      occurredAt,
      identifiers: [{ type: "visitor" as const, value: distinctId }],
      propertyId: property.id,
      brandId: property.brandId,
      sessionId,
      pagePath: page.path,
      isBot: looksLikeBot(userAgent),
    };
    events.push(
      startsSession
        ? {
            ...common,
            // One start per session however many imports cover it, so a
            // range that begins mid-session cannot add a second touch.
            sourceEventId: `session:${sessionId}`,
            eventType: "session_start",
            landingHost: page.host,
            landingPath: page.path,
            referrerHost: ref.host,
            referrerPath: ref.path,
            utmSource,
            utmMedium,
            utmCampaign: page.utmCampaign ?? text(row.utm_campaign, 150),
            utmTerm: page.utmTerm ?? text(row.utm_term, 150),
            utmContent: page.utmContent ?? text(row.utm_content, 150),
            clickIdKind: page.clickIdKind,
            clickId: page.clickId,
          }
        : { ...common, sourceEventId: `pv:${uuid}`, eventType: "page_view" },
    );
  }
  return { events, summary };
}

/** Registered websites by host, in the form the normaliser reads. */
export const hostMap = (
  properties: { id: string; host: string; brandId: string | null }[],
) =>
  new Map(
    properties.map((p) => [
      normalizeHost(p.host) ?? p.host,
      { id: p.id, brandId: p.brandId },
    ]),
  );
