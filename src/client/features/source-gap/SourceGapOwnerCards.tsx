import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  DISCOVERY_LABELS,
  GAP_OUTCOME_EXPLANATIONS,
  GAP_OUTCOME_LABELS,
  isCandidateRead,
  OWNER_PAGE_TYPE_LABELS,
  RETRIEVAL_LABELS,
  type OwnerCandidate,
  type OwnerSelection,
} from "@/shared/source-gap-owner";
import { shortUrl } from "./sourceGapShared";

const TOP = 3;

function List({ items }: { items: string[] | undefined }) {
  if (!items?.length) return null;
  return (
    <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

/** Whether Caldrin could tell if a page for the prompt exists, and why. */
export function OwnerOutcome({ owner }: { owner: OwnerSelection }) {
  if (!owner.outcome) return null;
  return (
    <p className="text-sm">
      <Badge
        variant={
          owner.outcome === "EXISTING_OWNER_CONFIRMED" ? "secondary" : "outline"
        }
      >
        {GAP_OUTCOME_LABELS[owner.outcome]}
      </Badge>{" "}
      {GAP_OUTCOME_EXPLANATIONS[owner.outcome]}
    </p>
  );
}

function CandidateCard({
  candidate: c,
  chosen,
  busy,
  onRetry,
  onChoose,
}: {
  candidate: OwnerCandidate;
  /** True when a person chose this page. */
  chosen: boolean;
  busy: boolean;
  onRetry: (url: string) => void;
  onChoose: (url: string) => void;
}) {
  const read = isCandidateRead(c);
  return (
    <li className="space-y-1.5 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {c.retrieval ? (
          <Badge variant={read ? "secondary" : "outline"}>
            {RETRIEVAL_LABELS[c.retrieval]}
          </Badge>
        ) : null}
        {read && c.pageType ? (
          <Badge variant="outline">{OWNER_PAGE_TYPE_LABELS[c.pageType]}</Badge>
        ) : null}
        {read ? (
          <span className="text-xs text-muted-foreground">
            relevance {c.score.toFixed(2)}
            {c.confidence ? `, ${c.confidence} confidence` : ""}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Not assessed</span>
        )}
        {chosen ? <Badge variant="outline">Manually selected</Badge> : null}
      </div>
      <a
        href={c.url}
        target="_blank"
        rel="noreferrer"
        className="block text-sm font-medium break-all underline-offset-2 hover:underline"
      >
        {c.title || shortUrl(c.url)}
      </a>
      {c.alsoListedAs?.length ? (
        <p className="text-xs text-muted-foreground break-all">
          Same page as {c.alsoListedAs.map(shortUrl).join(", ")}, which
          redirects here.
        </p>
      ) : null}
      {c.declaredCanonical ? (
        <p className="text-xs text-muted-foreground break-all">
          Its canonical tag names {shortUrl(c.declaredCanonical)}.
        </p>
      ) : null}
      {!read && c.retrievalNote ? (
        <p className="text-xs text-muted-foreground">{c.retrievalNote}</p>
      ) : null}
      {read ? <List items={c.reasons} /> : null}
      {c.missingEvidence?.length ? (
        <div className="space-y-0.5">
          <p className="text-xs font-medium">Missing or not judged</p>
          <List items={c.missingEvidence} />
        </div>
      ) : null}
      <List items={c.ranking} />
      {c.discoveredVia?.length ? (
        <p className="text-xs text-muted-foreground">
          Considered because of:{" "}
          {c.discoveredVia.map((d) => DISCOVERY_LABELS[d]).join(", ")}.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-0.5">
        {c.retryable && !read ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onRetry(c.url)}
          >
            Try reading again
          </Button>
        ) : null}
        {!chosen ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onChoose(c.url)}
          >
            Use this page
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** The three closest pages side by side, then any plausible page that could not be read. */
export function CandidateCards({
  owner,
  busy,
  onRetry,
  onChoose,
}: {
  owner: OwnerSelection;
  busy: boolean;
  onRetry: (url: string) => void;
  onChoose: (url: string) => void;
}) {
  const top = owner.candidates.slice(0, TOP);
  const rest = owner.candidates.slice(TOP).filter((c) => !isCandidateRead(c));
  if (owner.candidates.length === 0) return null;
  const card = (c: OwnerCandidate) => (
    <CandidateCard
      key={c.url}
      candidate={c}
      chosen={owner.overridden && owner.selected?.url === c.url}
      busy={busy}
      onRetry={onRetry}
      onChoose={onChoose}
    />
  );
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Closest pages compared</p>
        <ol className="grid items-start gap-2 lg:grid-cols-3">
          {top.map(card)}
        </ol>
      </div>
      {rest.length ? (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Plausible pages not read</p>
          <ol className="grid items-start gap-2 lg:grid-cols-3">
            {rest.map(card)}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
