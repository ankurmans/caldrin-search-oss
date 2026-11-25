import type { SnapshotFetchStatus, SnapshotView } from "@/shared/source-gap";
import { extractPage } from "./pageExtractor";

/** Neutral filler, so a fixture page has the body a real page would. */
const FILLER =
  "We wrote this page for people who want a straight answer before they spend any time or money. It explains what we know, how we checked it, and where we are unsure, and we revise it when something changes. " +
  "Read the sections that matter to you and skip the rest, because each one stands on its own and none of them depends on another. If something here is wrong or out of date, tell us and we will fix it.";

export type PageSpec =
  | { kind: "roundup"; title: string; items: string[]; blurb?: string }
  | { kind: "howto"; title: string; steps: string[] }
  | { kind: "pricing"; title: string; plans: string[] }
  | { kind: "product"; title: string; name: string; blurb: string }
  /** A page about the topic that is not clearly any one kind. */
  | { kind: "article"; title: string; paragraphs: string[] };

export const rd = (title: string, items: string[]): PageSpec => ({
  kind: "roundup",
  title,
  items,
});
export const ht = (title: string, steps: string[]): PageSpec => ({
  kind: "howto",
  title,
  steps,
});
export const pr = (title: string, plans: string[]): PageSpec => ({
  kind: "pricing",
  title,
  plans,
});
export const pd = (title: string, name: string, blurb: string): PageSpec => ({
  kind: "product",
  title,
  name,
  blurb,
});
export const ar = (title: string, ...paragraphs: string[]): PageSpec => ({
  kind: "article",
  title,
  paragraphs,
});

const wrap = (title: string, body: string, head = "") =>
  `<html><head><title>${title}</title>${head}</head><body><h1>${title}</h1>${body}<p>${FILLER}</p></body></html>`;

function render(spec: PageSpec, links: string[]): string {
  const nav = links.map((l) => `<a href="${l}">more</a>`).join("");
  switch (spec.kind) {
    case "roundup":
      return wrap(
        spec.title,
        `<p>We compared each option on price, quality and fit. ${spec.blurb ?? ""}</p>
<table><tr><th>Option</th><th>Price</th></tr>${spec.items.map((i) => `<tr><td>${i}</td><td>$9 a month</td></tr>`).join("")}</table>
${spec.items.map((i) => `<h2>${i}: where it fits and where it does not</h2><p>${i} suits some people.</p>`).join("")}
<h2>Which one should you choose?</h2><p>Our pick depends on the job.</p>${nav}`,
      );
    case "howto":
      return wrap(
        spec.title,
        `${spec.steps.map((s, i) => `<h2>Step ${i + 1}: ${s}</h2><p>${s}.</p>`).join("")}${nav}`,
      );
    case "pricing":
      return wrap(
        spec.title,
        `<table><tr><th>Plan</th><th>Price</th></tr>${spec.plans.map((p) => `<tr><td>${p}</td><td>$29 once</td></tr>`).join("")}</table><p>Prices are in dollars. No subscription.</p>${nav}`,
      );
    case "product":
      return wrap(
        spec.title,
        `<p>${spec.blurb}</p><h2>Features</h2><p>Fast and private.</p><h2>Download</h2><p>Free to try.</p>${nav}`,
        `<script type="application/ld+json">{"@type":"SoftwareApplication","name":"${spec.name}"}</script>`,
      );
    case "article":
      return wrap(
        spec.title,
        `${spec.paragraphs.map((p) => `<p>${p}</p>`).join("")}${nav}`,
      );
  }
}

export interface WebPageEntry {
  spec?: PageSpec;
  /** Raw html, for a page that is too short to judge. */
  html?: string;
  /** Addresses this page links to. */
  links?: string[];
  /** The address this one redirects to. */
  to?: string;
  /** The page answers with a server error this many times, then works. */
  failTimes?: number;
  blocked?: boolean;
  gone?: boolean;
}

const view = (
  url: string,
  status: SnapshotFetchStatus,
  extra: Partial<SnapshotView> = {},
): SnapshotView => ({
  id: url,
  url,
  normalizedUrl: url,
  status,
  httpStatus: null,
  fetchedAt: "2026-11-22T00:00:00.000Z",
  contentHash: null,
  rendered: false,
  page: null,
  note: null,
  ...extra,
});

/** A fake site: `fetchSnapshot` behaves as the snapshot service does, and records what was read. */
export function fakeWeb(site: Record<string, WebPageEntry>) {
  const attempts = new Map<string, number>();
  const served = new Set<string>();
  const fetchSnapshot = async (url: string): Promise<SnapshotView | null> => {
    const tries = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, tries);
    let at = url;
    for (let hop = 0; site[at]?.to && hop < 5; hop++) at = site[at].to ?? at;
    const entry = site[at];
    if (!entry || entry.gone) return view(url, "not_found");
    if (entry.blocked)
      return view(url, "blocked_by_robots", {
        note: "The site's robots.txt does not allow this fetch.",
      });
    if (entry.failTimes && tries <= entry.failTimes)
      return view(url, "http_error", {
        httpStatus: 503,
        note: "The site answered HTTP 503.",
      });
    const html =
      entry.html ?? (entry.spec && render(entry.spec, entry.links ?? []));
    if (!html) return view(url, "not_found");
    served.add(at);
    return view(url, "ok", { httpStatus: 200, page: extractPage(html, at) });
  };
  return { fetchSnapshot, attempts, served };
}
