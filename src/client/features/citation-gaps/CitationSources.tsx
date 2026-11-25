import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { Badge } from "@/client/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { AI_ENGINE_LABELS } from "@/shared/ai-visibility";
import type {
  CitationSourceKind,
  CitationSourceRow,
} from "@/shared/citation-gaps";
import { EngineIcon } from "../ai-visibility/EngineIcon";
import { AiLoading, AiQueryError } from "../ai-visibility/shared";
import {
  citationSourceQueryOptions,
  type CitationGapFilters,
} from "./citationGapsShared";

const KIND_LABEL: Record<CitationSourceKind, string> = {
  own: "Your site",
  competitor: "Competitor's site",
  third_party: "Third party",
};

const day = (value: string | null) =>
  value ? new Date(value).toLocaleDateString() : "—";

function SourceDetail({
  projectId,
  filters,
  domain,
}: {
  projectId: string;
  filters: CitationGapFilters;
  domain: string;
}) {
  const query = useQuery(
    citationSourceQueryOptions(projectId, filters, domain),
  );
  if (query.isPending) return <AiLoading />;
  if (query.isError)
    return (
      <AiQueryError error={query.error} retry={() => void query.refetch()} />
    );
  const detail = query.data;
  return (
    <div className="space-y-4 px-4 pb-6">
      <p className="text-xs text-muted-foreground">
        Passages are the saved AI answer's own words around the citation. The
        cited page itself was not fetched, and being cited does not mean it
        endorses any brand the answer names.
      </p>
      <ul className="space-y-3">
        {detail.answers.map((answer) => (
          <li
            key={answer.observationId}
            className="space-y-2 rounded-lg border p-3"
          >
            <p className="text-sm font-medium">{answer.prompt}</p>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <EngineIcon
                engine={answer.engine}
                className="size-3.5"
                aria-hidden
              />
              {AI_ENGINE_LABELS[answer.engine]} · {answer.promptGroup} ·{" "}
              {answer.collectedAt
                ? new Date(answer.collectedAt).toLocaleString()
                : "time not recorded"}
            </p>
            <ul className="space-y-1 text-xs">
              {answer.urls.map((url) => (
                <li key={url} className="break-all">
                  <SafeExternalLink
                    url={url}
                    label={url}
                    className="underline-offset-4 hover:underline"
                  />
                </li>
              ))}
            </ul>
            {answer.passages.length ? (
              answer.passages.map((p) => (
                <blockquote
                  key={p}
                  className="border-l-2 pl-3 text-sm text-muted-foreground"
                >
                  {p}
                </blockquote>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">
                The answer lists this source without quoting it inline.
              </p>
            )}
            <p className="text-xs">
              <span className="text-muted-foreground">
                Brands named in this answer:{" "}
              </span>
              {answer.brandsNamed.length
                ? answer.brandsNamed
                    .map((b) => (b.own ? `${b.name} (you)` : b.name))
                    .join(", ")
                : "none"}
            </p>
          </li>
        ))}
      </ul>
      {detail.truncated ? (
        <p className="text-xs text-muted-foreground">
          Showing the newest {detail.answers.length} answers.
        </p>
      ) : null}
    </div>
  );
}

export function CitationSources({
  projectId,
  filters,
  sources,
  answered,
}: {
  projectId: string;
  filters: CitationGapFilters;
  sources: CitationSourceRow[];
  answered: number;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section
      className="space-y-3 rounded-xl border bg-card p-4 md:p-6"
      aria-label="Cited sources"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Cited sources</h2>
        <p className="text-xs text-muted-foreground">
          Each site counted once per answer, out of {answered} answered
          collections.
        </p>
      </div>
      {sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No answers in this selection cite a source.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site</TableHead>
                <TableHead>Cited in</TableHead>
                <TableHead>Prompts</TableHead>
                <TableHead>Engines</TableHead>
                <TableHead>Brands named alongside</TableHead>
                <TableHead>You named</TableHead>
                <TableHead>Seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((s) => (
                <TableRow
                  key={s.domain}
                  className="cursor-pointer"
                  onClick={() => setOpen(s.domain)}
                >
                  <TableCell className="min-w-48">
                    <button
                      type="button"
                      className="text-left font-medium hover:underline"
                      aria-label={`Inspect ${s.domain}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen(s.domain);
                      }}
                    >
                      {s.domain}
                    </button>
                    <Badge variant="outline" size="sm" className="ml-2">
                      {KIND_LABEL[s.kind]}
                    </Badge>
                    <span className="block text-xs text-muted-foreground">
                      {s.urls.length} page(s) · {s.promptGroups.join(", ")}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {s.answers}
                    <span className="block text-xs text-muted-foreground">
                      of {answered}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">{s.prompts}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-2 text-xs">
                      {s.engines.map((e) => (
                        <span
                          key={e.engine}
                          className="inline-flex items-center gap-1"
                          title={AI_ENGINE_LABELS[e.engine]}
                        >
                          <EngineIcon
                            engine={e.engine}
                            className="size-3.5"
                            aria-hidden
                          />
                          <span className="sr-only">
                            {AI_ENGINE_LABELS[e.engine]}
                          </span>
                          {e.answers}
                        </span>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs">
                    {s.brandsNamed
                      .slice(0, 3)
                      .map((b) => `${b.own ? "You" : b.name} (${b.answers})`)
                      .join(", ") || "—"}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {s.ownNamedAnswers} of {s.answers}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {day(s.firstSeen)} – {day(s.lastSeen)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Sheet
        open={open !== null}
        onOpenChange={(next) => !next && setOpen(null)}
      >
        <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-2xl">
          {open ? (
            <>
              <SheetHeader>
                <SheetTitle className="pr-8">{open}</SheetTitle>
                <SheetDescription>
                  Every answer in this selection that cites this site.
                </SheetDescription>
              </SheetHeader>
              <SourceDetail
                projectId={projectId}
                filters={filters}
                domain={open}
              />
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </section>
  );
}
