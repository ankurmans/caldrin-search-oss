import type { EvidenceInput, PageWindowRow } from "../types";

export function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function pagePath(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, "") || "/";
  } catch {
    return url;
  }
}

// The four Search Console numbers behind a row, one evidence row each, plus the
// window they cover.
export function gscMetricEvidence(input: {
  source: string;
  row: PageWindowRow & { query?: string };
  windowStart: string;
  windowEnd: string;
  observedAt: string;
  labelPrefix?: string;
}): EvidenceInput[] {
  const { source, row, windowStart, windowEnd, observedAt } = input;
  const prefix = input.labelPrefix ? `${input.labelPrefix}: ` : "";
  const base = { source, url: row.page, observedAt };
  const window = `${windowStart} to ${windowEnd}`;
  return [
    ...(row.query
      ? [{ ...base, label: `${prefix}Query`, value: row.query }]
      : []),
    { ...base, label: `${prefix}Impressions`, value: `${row.impressions}` },
    { ...base, label: `${prefix}Clicks`, value: `${row.clicks}` },
    { ...base, label: `${prefix}CTR`, value: pct(row.ctr) },
    {
      ...base,
      label: `${prefix}Average position`,
      value: row.position.toFixed(1),
    },
    { ...base, label: `${prefix}Window`, value: window },
  ];
}
