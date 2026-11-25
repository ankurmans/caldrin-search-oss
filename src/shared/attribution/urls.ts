import { normalizeHost } from "./channels";

const CLICK_IDS = [
  "gclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "fbclid",
  "ttclid",
  "li_fat_id",
] as const;

const clip = (value: string | null, max: number) =>
  value ? value.slice(0, max) : null;

type ParsedLanding = {
  host: string | null;
  path: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  clickIdKind: string | null;
  clickId: string | null;
};

const EMPTY_LANDING: ParsedLanding = {
  host: null,
  path: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmTerm: null,
  utmContent: null,
  clickIdKind: null,
  clickId: null,
};

function parse(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * The parts of a landing URL attribution needs. The query string is read for
 * campaign tags and one recognised click id and is not kept in any other form.
 */
export function parseLanding(value: string | null | undefined): ParsedLanding {
  const url = parse(value);
  if (!url) return EMPTY_LANDING;
  const q = url.searchParams;
  const clickIdKind = CLICK_IDS.find((id) => q.get(id)) ?? null;
  return {
    host: normalizeHost(url.hostname),
    path: clip(url.pathname || "/", 300),
    utmSource: clip(q.get("utm_source"), 100),
    utmMedium: clip(q.get("utm_medium"), 100),
    utmCampaign: clip(q.get("utm_campaign"), 150),
    utmTerm: clip(q.get("utm_term"), 150),
    utmContent: clip(q.get("utm_content"), 150),
    clickIdKind,
    clickId: clickIdKind ? clip(q.get(clickIdKind), 200) : null,
  };
}

/** A referrer's host and path. Its query string can carry anything and is dropped. */
export function parseReferrer(value: string | null | undefined) {
  const url = parse(value);
  if (!url) return { host: null, path: null };
  return { host: normalizeHost(url.hostname), path: clip(url.pathname, 300) };
}
