import type {
  CitedSourceSummary,
  SnapshotView,
  SourceGapAnalysis,
} from "@/shared/source-gap";
import {
  SourceGapRepository,
  type StoredAnalysis,
} from "./sourceGapRepository";
import { snapshotView } from "./sourceSnapshotService";
import { mergeByCanonical } from "./sourceUrl";

/** Cited pages fetched per analysis; the rest are listed and marked skipped. */
export const MAX_SOURCES_FETCHED = 12;

export function skipped(url: string, key: string, now: string): SnapshotView {
  return {
    id: `skipped:${key}`,
    url,
    normalizedUrl: key,
    status: "skipped",
    httpStatus: null,
    fetchedAt: now,
    contentHash: null,
    rendered: false,
    page: null,
    note: `Only the ${MAX_SOURCES_FETCHED} most-cited readable pages are fetched per analysis.`,
  };
}

/** Pages whose canonical tag names another cited page are counted as that page. */
export function mergeCanonical(
  sources: CitedSourceSummary[],
): CitedSourceSummary[] {
  const target = mergeByCanonical(
    sources.map((s) => ({
      key: s.url,
      canonical: s.snapshot?.page?.canonical ?? null,
    })),
  );
  const merged = new Map<string, CitedSourceSummary>();
  for (const source of sources) {
    const key = target.get(source.url) ?? source.url;
    const kept = merged.get(key);
    if (!kept) {
      merged.set(key, source);
      continue;
    }
    for (const id of source.observationIds)
      if (!kept.observationIds.includes(id)) kept.observationIds.push(id);
    kept.answers = kept.observationIds.length;
    for (const e of source.engines)
      if (!kept.engines.includes(e)) kept.engines.push(e);
    for (const b of source.brandsNamedInAnswers)
      if (!kept.brandsNamedInAnswers.includes(b))
        kept.brandsNamedInAnswers.push(b);
    kept.ownNamedInAnswers ||= source.ownNamedInAnswers;
  }
  return [...merged.values()];
}

const strip = (s: SnapshotView | null) => (s ? { ...s, page: null } : null);

/** Without the page body, which is read back from its snapshot by id. */
export function stripped(analysis: SourceGapAnalysis): SourceGapAnalysis {
  return {
    ...analysis,
    ownerSnapshot: strip(analysis.ownerSnapshot),
    sources: analysis.sources.map((s) => ({
      ...s,
      snapshot: strip(s.snapshot),
    })),
  };
}

export async function hydrate(
  projectId: string,
  row: StoredAnalysis,
): Promise<SourceGapAnalysis> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stored JSON was written by this service
  const analysis = JSON.parse(row.resultJson) as SourceGapAnalysis;
  const ids = [
    analysis.ownerSnapshot?.id,
    ...analysis.sources.map((s) => s.snapshot?.id),
  ].filter((id): id is string => !!id && !id.startsWith("skipped:"));
  const rows = await SourceGapRepository.snapshotsByIds(projectId, ids);
  const byId = new Map(rows.map((r) => [r.id, snapshotView(r)]));
  const fill = (s: SnapshotView | null) => (s ? (byId.get(s.id) ?? s) : null);
  return {
    ...analysis,
    opportunityId: row.opportunityId,
    ownerSnapshot: fill(analysis.ownerSnapshot),
    sources: analysis.sources.map((s) => ({
      ...s,
      snapshot: fill(s.snapshot),
    })),
  };
}
