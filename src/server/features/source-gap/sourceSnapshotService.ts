import type { ParsedPage, SnapshotView } from "@/shared/source-gap";
import { extractPage } from "./pageExtractor";
import { THIN_PAGE_WORDS } from "./pageSignals";
import {
  SourceGapRepository,
  type StoredSnapshot,
} from "./sourceGapRepository";
import {
  fetchSourcePage,
  type FetchDeps,
  type FetchedPage,
} from "./sourcePageFetcher";
import { normalizeSourceUrl } from "./sourceUrl";

const HOUR_MS = 3_600_000;
/** A page that read fine is reused for this long unless a refresh is forced. */
const SNAPSHOT_TTL_MS = 24 * HOUR_MS;
/** A page that could not be read is retried sooner. */
const FAILED_SNAPSHOT_TTL_MS = 6 * HOUR_MS;

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function snapshotView(row: StoredSnapshot): SnapshotView {
  let page: ParsedPage | null = null;
  if (row.parsedJson) {
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stored JSON was written by this service
      page = JSON.parse(row.parsedJson) as ParsedPage;
    } catch {
      page = null;
    }
  }
  return {
    id: row.id,
    url: row.url,
    normalizedUrl: row.normalizedUrl,
    status: row.status,
    httpStatus: row.httpStatus,
    fetchedAt: row.fetchedAt,
    contentHash: row.contentHash,
    rendered: row.rendered,
    page,
    note: row.note,
  };
}

type SnapshotRequest = {
  projectId: string;
  url: string;
  forceRefresh?: boolean;
  now?: Date;
  deps?: FetchDeps;
};

/**
 * The stored copy of a page, fetching it only when there is none or it is
 * older than the cache window. A re-read that finds the same content moves the
 * copy's timestamp; changed content is stored as a new copy so analyses made
 * earlier keep the page they actually compared.
 */
export async function getSnapshot(
  request: SnapshotRequest,
): Promise<SnapshotView | null> {
  const key = normalizeSourceUrl(request.url);
  if (!key) return null;
  const now = request.now ?? new Date();
  const latest = await SourceGapRepository.latestSnapshot(
    request.projectId,
    key,
  );
  if (latest && !request.forceRefresh) {
    const age = now.getTime() - Date.parse(latest.fetchedAt);
    const ttl =
      latest.status === "ok" ? SNAPSHOT_TTL_MS : FAILED_SNAPSHOT_TTL_MS;
    if (age >= 0 && age < ttl) return snapshotView(latest);
  }
  const fetched = await fetchSourcePage(request.url, request.deps);
  return storeFetched(
    { projectId: request.projectId, url: request.url, key, latest, now },
    fetched,
  );
}

async function storeFetched(
  target: {
    projectId: string;
    url: string;
    key: string;
    latest: StoredSnapshot | null;
    now: Date;
  },
  fetched: FetchedPage,
): Promise<SnapshotView> {
  const { projectId, url, key, latest, now } = target;
  const fetchedAt = now.toISOString();
  let parsed: ParsedPage | null = null;
  let note = fetched.note;
  if (fetched.status === "ok" && fetched.html !== null) {
    parsed = extractPage(fetched.html, fetched.finalUrl);
    if (parsed.wordCount < THIN_PAGE_WORDS)
      note =
        "Very little visible text was read; the page may need JavaScript to show its content.";
  }
  const contentHash = parsed ? await sha256(parsed.text) : null;
  if (
    latest &&
    parsed &&
    latest.status === "ok" &&
    latest.contentHash === contentHash
  ) {
    await SourceGapRepository.touchSnapshot(projectId, latest.id, fetchedAt);
    return snapshotView({ ...latest, fetchedAt });
  }
  const stored = await SourceGapRepository.insertSnapshot({
    projectId,
    url,
    normalizedUrl: key,
    status: fetched.status,
    httpStatus: fetched.httpStatus,
    fetchedAt,
    contentHash,
    rendered: false,
    parsedJson: parsed ? JSON.stringify(parsed) : null,
    note,
  });
  return snapshotView(stored);
}
