import { isOnDomain } from "@/server/features/citation-gaps/citationSourceRules";
import type { CitedSourceSummary, SnapshotView } from "@/shared/source-gap";
import type { OwnerCandidate, OwnerSelection } from "@/shared/source-gap-owner";
import {
  evidenceQualityOf,
  gapOutcomeOf,
  missingEvidenceOf,
  rankingReasons,
  retrievalOf,
} from "./ownerAssessment";
import { loadOwnerInputs } from "./ownerCandidates";
import { ownerPageType, pageTypeFit, promptWants } from "./ownerPageType";
import {
  PLAUSIBLE_OWNER_SCORE,
  rankOwnerCandidates,
  scoreOwnerCandidate,
  selectOwner,
  type OwnerInput,
} from "./ownerPageSelector";
import { isFileUrl, isHomepageUrl, normalizeSourceUrl } from "./sourceUrl";

const FIRST_ROUND = 6;
/** Extra pages read in the first round, one per kind of page the prompt asks for. */
const TYPE_PROBES = 2;
/** Pages read after the first round: second tries and pages found through links. */
const SECOND_ROUND = 4;
const FETCH_CONCURRENCY = 4;
const MAX_LISTED = 8;

type FetchSnapshot = (
  url: string,
  forceRefresh?: boolean,
) => Promise<SnapshotView | null>;

async function inBatches<T>(
  items: T[],
  size: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size)
    await Promise.all(items.slice(i, i + size).map(work));
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Pages of the site that the pages already read link to and no list named.
 * A page reached only by a link is still a page of the site.
 */
function linkedInputs(
  snapshots: Map<string, SnapshotView>,
  known: Set<string>,
  domain: string,
): OwnerInput[] {
  const found: OwnerInput[] = [];
  for (const snap of snapshots.values())
    for (const link of snap.page?.internalLinks ?? []) {
      const key = normalizeSourceUrl(link);
      const host = hostOf(link);
      if (
        !key ||
        known.has(key) ||
        !host ||
        !isOnDomain(host, domain) ||
        isFileUrl(link) ||
        isHomepageUrl(link)
      )
        continue;
      known.add(key);
      found.push({ url: link, discoveredVia: ["internal_link"] });
    }
  return found;
}

type Prompt = { text: string; intent: string | null };

/**
 * The closest unread pages, one per kind the prompt asks for, judged by
 * address alone. Words in the prompt do not reach a page whose address says
 * "pricing" when the prompt says "cost", so the kind of page is what gets it
 * read. Reading it is all this does; how it scores comes from its content.
 */
function typeProbes(
  prompt: Prompt,
  inputs: OwnerInput[],
  skip: Set<string>,
): string[] {
  const wants = promptWants(prompt.text, prompt.intent);
  const best = new Map<string, { url: string; score: number }>();
  for (const item of inputs) {
    if (skip.has(item.url) || isHomepageUrl(item.url)) continue;
    const type = ownerPageType(item.url, item.title ?? "", null);
    const fit = pageTypeFit(wants, type, prompt.text, prompt.intent);
    if (type === "unknown" || fit === null || fit < 0.6) continue;
    const { score } = scoreOwnerCandidate(prompt.text, item, prompt.intent);
    const kept = best.get(type);
    if (!kept || score > kept.score) best.set(type, { url: item.url, score });
  }
  const probes = [...best.values()];
  probes.sort((a, b) => b.score - a.score);
  return probes.slice(0, TYPE_PROBES).map((b) => b.url);
}

/**
 * Reads the closest pages in two rounds: the best first guesses, then second
 * tries at pages that failed in a way that can pass and pages the first
 * round's links led to. Each round has a page budget.
 */
async function readSite(
  input: {
    prompt: Prompt;
    ownDomain: string;
    override: string | null;
    retryUrls: string[];
    fetchSnapshot: FetchSnapshot;
  },
  inputs: OwnerInput[],
): Promise<Map<string, SnapshotView>> {
  const { prompt } = input;
  const snapshots = new Map<string, SnapshotView>();
  const retry = new Set(input.retryUrls);
  const read = (urls: string[]) =>
    inBatches(urls, FETCH_CONCURRENCY, async (url) => {
      const snap = await input.fetchSnapshot(url, retry.has(url) || undefined);
      if (snap) snapshots.set(url, snap);
    });
  const cheapest = (count: number, skip: Set<string>) =>
    rankOwnerCandidates(
      prompt.text,
      inputs.map((i) => ({ ...i, page: snapshots.get(i.url)?.page ?? null })),
      prompt.intent,
    )
      .filter((c) => !skip.has(c.url))
      .slice(0, count);

  const firstRound = new Set([
    ...(input.override ? [input.override] : []),
    ...input.retryUrls,
    ...cheapest(FIRST_ROUND, new Set()).map((c) => c.url),
  ]);
  for (const url of typeProbes(prompt, inputs, firstRound)) firstRound.add(url);
  await read([...firstRound]);

  const again = [...firstRound].filter(
    (url) =>
      !retry.has(url) && retrievalOf(snapshots.get(url) ?? null).retryable,
  );
  const known = new Set(inputs.flatMap((i) => normalizeSourceUrl(i.url) ?? []));
  inputs.push(...linkedInputs(snapshots, known, input.ownDomain));
  const fresh = cheapest(MAX_LISTED, firstRound)
    .filter((c) => c.score >= PLAUSIBLE_OWNER_SCORE && !snapshots.has(c.url))
    .map((c) => c.url);
  for (const url of again) retry.add(url);
  await read([...new Set([...again, ...fresh])].slice(0, SECOND_ROUND));
  return snapshots;
}

interface Resolved {
  inputs: OwnerInput[];
  gone: string[];
  snapFor: (url: string) => SnapshotView | null;
}

/**
 * An address that redirects is the page it lands on, under that address.
 * Pages that no longer exist are not candidates, unless a person chose one.
 */
function resolvePages(
  inputs: OwnerInput[],
  snapshots: Map<string, SnapshotView>,
  override: string | null,
): Resolved {
  const byKey = new Map<string, SnapshotView>();
  for (const [url, snap] of snapshots) {
    byKey.set(normalizeSourceUrl(url) ?? url, snap);
    const final = snap.page ? normalizeSourceUrl(snap.page.finalUrl) : null;
    if (final && !byKey.has(final)) byKey.set(final, snap);
  }
  const snapFor = (url: string) =>
    byKey.get(normalizeSourceUrl(url) ?? url) ?? null;
  const gone: string[] = [];
  const resolved: OwnerInput[] = [];
  for (const item of inputs) {
    const snap = snapshots.get(item.url) ?? snapFor(item.url);
    if (snap?.status === "not_found" && item.url !== override) {
      gone.push(item.url);
      continue;
    }
    const page = snap?.page ?? null;
    const moved =
      page &&
      normalizeSourceUrl(page.finalUrl) !== normalizeSourceUrl(item.url);
    resolved.push({
      ...item,
      ...(moved ? { url: page.finalUrl, alsoListedAs: [item.url] } : {}),
      page,
      retrieval: retrievalOf(snap).state,
    });
  }
  return { inputs: resolved, gone, snapFor };
}

/** The candidate with how it was read, what it lacks and how sure it is; no confidence for an unread page. */
function assessed(
  c: OwnerCandidate,
  prompt: Prompt,
  snap: SnapshotView | null,
): OwnerCandidate {
  const page = snap?.page ?? null;
  const { state, note, retryable } = retrievalOf(snap);
  const out: OwnerCandidate = {
    ...c,
    retrieval: state,
    retrievalNote: note,
    retryable,
    evidenceQuality: evidenceQualityOf(page),
  };
  out.missingEvidence = missingEvidenceOf(
    out,
    page,
    prompt.text,
    prompt.intent,
  );
  if (!page) delete out.confidence;
  return out;
}

/**
 * The page of the project's own site that answers a prompt: a person's choice,
 * otherwise the best-scoring page. Every page the sitemap, crawl, Search
 * Console and the site's own links name is scored, the closest few are read,
 * and a page that could not be read is kept as "not assessed" rather than
 * treated as irrelevant. Several addresses that resolve to one page are one
 * candidate under the address they resolve to.
 */
export async function resolveOwner(input: {
  projectId: string;
  prompt: Prompt;
  ownDomain: string;
  override: string | null;
  /** Pages to read again even if a recent copy is stored. */
  retryUrls?: string[];
  sources: CitedSourceSummary[];
  fetchSnapshot: FetchSnapshot;
}): Promise<{ selection: OwnerSelection; ownerSnapshot: SnapshotView | null }> {
  const { prompt, override } = input;
  const loaded = input.ownDomain
    ? await loadOwnerInputs(input.projectId, input.ownDomain)
    : {
        inputs: [] as OwnerInput[],
        notes: ["The project has no domain set."],
        complete: false,
      };
  const listed = [...loaded.inputs];
  const snapshots = await readSite(
    { ...input, retryUrls: input.retryUrls ?? [] },
    listed,
  );
  const { inputs, gone, snapFor } = resolvePages(listed, snapshots, override);
  const assess = (c: OwnerCandidate) => assessed(c, prompt, snapFor(c.url));

  const ranked = rankOwnerCandidates(
    prompt.text,
    inputs.filter((i) => i.page),
    prompt.intent,
  ).map(assess);
  // A first guess from the address and title is not a judgement of the page,
  // so pages that were not read follow the ones that were.
  const unread = rankOwnerCandidates(
    prompt.text,
    inputs.filter((i) => !i.page),
    prompt.intent,
  )
    .filter((c) => c.score >= PLAUSIBLE_OWNER_SCORE)
    .map(assess);

  const overrideSnap = override ? snapFor(override) : null;
  const overridePage = overrideSnap?.page ?? null;
  const selection = selectOwner(
    prompt.text,
    ranked,
    override
      ? {
          url: overridePage?.finalUrl ?? override,
          candidate: overridePage
            ? assess(
                scoreOwnerCandidate(
                  prompt.text,
                  {
                    url: overridePage.finalUrl,
                    page: overridePage,
                    discoveredVia: ["manual"],
                    retrieval: retrievalOf(overrideSnap).state,
                  },
                  prompt.intent,
                ),
              )
            : null,
        }
      : null,
  );
  if (selection.selected && selection.overridden && !overridePage)
    selection.selected = assess(selection.selected);
  // A page that could not be read but looks at least as close as the pick may
  // be the real owner: it is listed first and the pick is only provisional.
  const picked = selection.overridden ? null : selection.selected;
  const closer = unread.filter(
    (c) => picked && c.retrieval !== "NOT_ATTEMPTED" && c.score >= picked.score,
  );
  if (picked && closer.length) {
    selection.confidence = "low";
    selection.selected = { ...picked, confidence: "low" };
    selection.notes.push(
      `${closer.map((c) => c.url).join(", ")} could not be read and looks at least as close as the page picked, so the pick is provisional.`,
    );
  }
  selection.candidates = [
    ...closer,
    ...ranked.map((c) =>
      c.url === picked?.url && closer.length
        ? { ...c, confidence: "low" as const }
        : c,
    ),
    ...unread.filter((c) => !closer.includes(c)),
  ].slice(0, MAX_LISTED);
  rankingReasons(selection.candidates);
  if (unread.length)
    selection.notes.push(
      `${unread.map((c) => c.url).join(", ")} could not be read, so ${unread.length === 1 ? "it was" : "they were"} not compared. ${unread.length === 1 ? "It is" : "They are"} not treated as missing.`,
    );
  if (gone.length)
    selection.notes.push(
      `${gone.length} listed page(s) no longer exist and were left out.`,
    );
  selection.pagesChecked = inputs.length;
  selection.listComplete = loaded.complete;
  selection.notes.push(...loaded.notes);
  selection.outcome = gapOutcomeOf({
    selected: selection.selected,
    confidence: selection.confidence,
    overridden: selection.overridden,
    candidates: selection.candidates.filter((c) => c !== selection.selected),
    listComplete: loaded.complete,
  });

  const key = selection.selected
    ? normalizeSourceUrl(selection.selected.url)
    : null;
  const ownerSnapshot =
    (selection.selected && snapFor(selection.selected.url)) ||
    (key ? input.sources.find((s) => s.url === key)?.snapshot : null) ||
    null;
  if (selection.selected && !ownerSnapshot?.page)
    selection.notes.push(
      "The selected page could not be read, so no page comparison was made.",
    );
  return { selection, ownerSnapshot };
}
