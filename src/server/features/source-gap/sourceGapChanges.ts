import { ROOT_CAUSE_LABELS, type SourceGapAnalysis } from "@/shared/source-gap";

type Comparable = Pick<
  SourceGapAnalysis,
  "owner" | "ownerSnapshot" | "sources" | "consensus" | "rootCauses"
>;

/**
 * What differs between two analyses of the same prompt, as plain sentences.
 * Both stay stored; nothing here overwrites the earlier one.
 */
export function describeChanges(
  previous: Comparable,
  current: Comparable,
): string[] {
  const out: string[] = [];
  const prevOwner = previous.owner.selected?.url ?? null;
  const owner = current.owner.selected?.url ?? null;
  if (prevOwner !== owner)
    out.push(
      owner
        ? `The closest page changed from ${prevOwner ?? "none"} to ${owner}.`
        : `There is no longer a page that scores as the owner (was ${prevOwner}).`,
    );
  else if (
    previous.ownerSnapshot?.contentHash &&
    current.ownerSnapshot?.contentHash &&
    previous.ownerSnapshot.contentHash !== current.ownerSnapshot.contentHash
  )
    out.push("Your owner page's content changed since the last analysis.");

  for (const now of current.consensus) {
    const before = previous.consensus.find((p) => p.key === now.key);
    if (!before) continue;
    if (before.yours === false && now.yours === true)
      out.push(
        `Your owner page now has what ${now.citedCount} of ${now.readable} cited pages have: they ${now.label}.`,
      );
    if (before.yours === true && now.yours === false)
      out.push(
        `Your owner page no longer has what ${now.citedCount} of ${now.readable} cited pages have: they ${now.label}.`,
      );
    if (
      before.citedCount !== now.citedCount ||
      before.readable !== now.readable
    )
      out.push(
        `Pages that ${now.label}: ${before.citedCount} of ${before.readable} before, ${now.citedCount} of ${now.readable} now.`,
      );
  }

  const prevUrls = new Set(previous.sources.map((s) => s.url));
  const urls = new Set(current.sources.map((s) => s.url));
  const added = [...urls].filter((u) => !prevUrls.has(u));
  const dropped = [...prevUrls].filter((u) => !urls.has(u));
  if (added.length) out.push(`Newly cited: ${added.slice(0, 5).join(", ")}.`);
  if (dropped.length)
    out.push(`No longer cited: ${dropped.slice(0, 5).join(", ")}.`);

  for (const source of current.sources) {
    const before = previous.sources.find((s) => s.url === source.url);
    const a = before?.snapshot?.contentHash;
    const b = source.snapshot?.contentHash;
    if (a && b && a !== b)
      out.push(`${source.url} changed since the last analysis.`);
    if (before && !before.ownOnPage && source.ownOnPage)
      out.push(`${source.url} now names you.`);
  }

  const prevCauses = new Set(previous.rootCauses.map((c) => c.category));
  const causes = new Set(current.rootCauses.map((c) => c.category));
  for (const c of causes)
    if (!prevCauses.has(c)) out.push(`New finding: ${ROOT_CAUSE_LABELS[c]}.`);
  for (const c of prevCauses)
    if (!causes.has(c)) out.push(`No longer found: ${ROOT_CAUSE_LABELS[c]}.`);
  return out;
}
