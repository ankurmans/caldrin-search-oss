import { Badge } from "@/client/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import {
  GAP_DIMENSION_LABELS,
  SNAPSHOT_STATUS_LABELS,
  SOURCE_TYPE_LABELS,
  type CitedSourceSummary,
  type ConsensusPattern,
  type DimensionVerdict,
  type SourceDifference,
} from "@/shared/source-gap";
import { ageLabel, shortUrl } from "./sourceGapShared";

const VERDICT_LABEL: Record<DimensionVerdict, string> = {
  cited_stronger: "Cited page stronger",
  similar: "Similar",
  yours_stronger: "Yours stronger",
  not_measured: "Not measured",
  not_comparable: "Descriptive only",
};
const VERDICT_CLASS: Record<DimensionVerdict, string> = {
  cited_stronger: "text-warning",
  similar: "text-muted-foreground",
  yours_stronger: "text-success",
  not_measured: "text-muted-foreground",
  not_comparable: "text-muted-foreground",
};

export function CitedSources({ sources }: { sources: CitedSourceSummary[] }) {
  return (
    <ul className="space-y-2">
      {sources.map((s) => (
        <li key={s.url} className="space-y-1 rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{SOURCE_TYPE_LABELS[s.sourceType]}</Badge>
            {s.brandName ? (
              <span className="text-xs text-muted-foreground">
                {s.brandName}
              </span>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {s.answers} answer(s) · {s.engines.join(", ")}
            </span>
          </div>
          <a
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="block text-sm font-medium break-words underline-offset-2 hover:underline"
          >
            {s.title || shortUrl(s.url)}
          </a>
          <p className="text-xs break-all text-muted-foreground">{s.url}</p>
          <p className="text-xs text-muted-foreground">
            {s.snapshot
              ? s.snapshot.status === "ok"
                ? `Read ${ageLabel(s.snapshot.fetchedAt)}${
                    s.snapshot.note ? `. ${s.snapshot.note}` : ""
                  }`
                : `${SNAPSHOT_STATUS_LABELS[s.snapshot.status]}${
                    s.snapshot.note ? `: ${s.snapshot.note}` : ""
                  }`
              : "Not read"}
          </p>
          {s.brandsOnPage.length || s.ownOnPage ? (
            <p className="text-xs">
              <span className="text-muted-foreground">Names on the page: </span>
              {[...s.brandsOnPage, ...(s.ownOnPage ? ["you"] : [])].join(", ")}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function ConsensusList({
  patterns,
  hasOwner,
}: {
  patterns: ConsensusPattern[];
  hasOwner: boolean;
}) {
  const shown = patterns.filter((p) => p.citedCount > 0);
  if (shown.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No pattern could be counted: no cited page was readable.
      </p>
    );
  return (
    <ul className="space-y-1.5">
      {shown.map((p) => (
        <li
          key={p.key}
          className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
        >
          <span>
            <span className="font-medium tabular-nums">
              {p.citedCount} of {p.readable}
            </span>{" "}
            cited pages {p.label}
          </span>
          {hasOwner ? (
            <Badge variant={p.yours ? "secondary" : "outline"}>
              {p.yours ? "Your page does too" : "Your page does not"}
            </Badge>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function DifferenceMatrix({
  differences,
}: {
  differences: SourceDifference[];
}) {
  if (differences.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No cited page could be read, so there is nothing to compare.
      </p>
    );
  return (
    <div className="space-y-2">
      {differences.map((d) => (
        <Collapsible key={d.url} className="rounded-lg border bg-card">
          <CollapsibleTrigger className="w-full px-3 py-2 text-left text-sm font-medium break-all">
            {shortUrl(d.url)}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dimension</TableHead>
                  <TableHead>Cited page</TableHead>
                  <TableHead>Your page</TableHead>
                  <TableHead>Gap</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.rows.map((r) => (
                  <TableRow key={r.dimension}>
                    <TableCell className="font-medium">
                      {GAP_DIMENSION_LABELS[r.dimension]}
                    </TableCell>
                    <TableCell className="text-xs">{r.cited}</TableCell>
                    <TableCell className="text-xs">{r.yours}</TableCell>
                    <TableCell
                      className={`text-xs ${VERDICT_CLASS[r.verdict]}`}
                    >
                      {VERDICT_LABEL[r.verdict]}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}
