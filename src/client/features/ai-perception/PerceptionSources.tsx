import { useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Badge } from "@/client/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { ExternalUrlCell } from "@/client/components/table/url";
import { EngineLabel } from "@/client/features/ai-visibility/EngineLabel";
import {
  ofText,
  pct,
  type InsightsFilters,
} from "@/client/features/ai-visibility/insights/insightsShared";
import {
  AiLoading,
  AiQueryError,
} from "@/client/features/ai-visibility/shared";
import { SOURCE_CLASS_LABELS } from "@/server/features/source-intelligence/rules/sourceClass";
import type {
  AiPerceptionSources,
  PerceptionSourceRow,
} from "@/shared/ai-perception-sources";
import { AnswerCard } from "./PerceptionCellSheet";
import {
  OutcomeBar,
  OutcomeLegend,
  perceptionSourceEvidenceQueryOptions,
} from "./perceptionShared";

const CLASS_FILTERS = [
  { value: "all", label: "All sources" },
  { value: "own", label: "Your site" },
  { value: "competitor", label: "Competitors" },
  { value: "third", label: "Third-party" },
] as const;

const classLabels: Record<string, string> = SOURCE_CLASS_LABELS;
const classLabel = (value: string) => classLabels[value] ?? value;

function SourceSheet({
  projectId,
  filters,
  brandDomain,
  source,
  onClose,
}: {
  projectId: string;
  filters: InsightsFilters;
  brandDomain: string;
  source: PerceptionSourceRow | null;
  onClose: () => void;
}) {
  const query = useQuery({
    ...perceptionSourceEvidenceQueryOptions(projectId, filters, {
      domain: brandDomain,
      sourceDomain: source?.domain ?? "",
    }),
    enabled: source !== null,
  });
  return (
    <Sheet open={source !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{source?.domain}</SheetTitle>
          <SheetDescription>
            Answers that cite this source, with how each treated the brand. They
            appear together; the source is not shown to have caused it.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-4">
          {query.isPending ? (
            <AiLoading />
          ) : query.isError ? (
            <AiQueryError
              error={query.error}
              retry={() => {
                void query.refetch();
              }}
            />
          ) : (
            <>
              <ul className="space-y-1 text-sm">
                {query.data.pages.map((p) => (
                  <li key={p.url} className="min-w-0">
                    <ExternalUrlCell value={p.url} label={p.title ?? p.url} />
                  </li>
                ))}
              </ul>
              <ul className="space-y-3">
                {query.data.answers.map((a) => (
                  <AnswerCard
                    key={a.observationId}
                    projectId={projectId}
                    answer={a}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function PerceptionSources({
  projectId,
  filters,
  query,
}: {
  projectId: string;
  filters: InsightsFilters;
  query: UseQueryResult<AiPerceptionSources>;
}) {
  const [filter, setFilter] =
    useState<(typeof CLASS_FILTERS)[number]["value"]>("all");
  const [open, setOpen] = useState<PerceptionSourceRow | null>(null);
  if (query.isPending) return <AiLoading />;
  if (query.isError)
    return (
      <AiQueryError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const data = query.data;
  const rows = data.sources.filter((s) =>
    filter === "all"
      ? true
      : filter === "third"
        ? s.sourceClass !== "own" && s.sourceClass !== "competitor"
        : s.sourceClass === filter,
  );
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-base font-medium">Sources behind the answers</h2>
        <p className="text-sm text-muted-foreground">
          For answers that track {data.brand?.name ?? "this brand"}, the sources
          they cite beside how each answer treated the brand. A source appearing
          in favourable answers does not mean it caused them. The brand's
          overall recommended rate is{" "}
          <span className="font-medium text-foreground">
            {pct(data.baseline.rate)}
          </span>{" "}
          ({ofText(data.baseline)} read mentions).
        </p>
      </div>
      {data.notes.map((n) => (
        <p key={n} className="text-xs text-muted-foreground">
          {n}
        </p>
      ))}
      <div
        className="flex flex-wrap gap-1"
        role="group"
        aria-label="Source type"
      >
        {CLASS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-md border px-3 py-1.5 text-sm ${filter === f.value ? "bg-muted font-medium" : "text-muted-foreground"}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <OutcomeLegend />
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="p-3 font-medium">Source</th>
              <th className="p-3 font-medium">Answers citing it</th>
              <th className="p-3 font-medium">Brand in those answers</th>
              <th className="p-3 font-medium">Recommended</th>
              <th className="p-3 font-medium">Engines</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.domain} className="border-b last:border-0 align-top">
                <td className="max-w-72 p-3">
                  <button
                    type="button"
                    onClick={() => setOpen(s)}
                    className="block text-left font-medium hover:underline"
                  >
                    {s.domain}
                  </button>
                  <Badge variant="secondary" className="mt-1">
                    {classLabel(s.sourceClass)}
                  </Badge>
                  {s.retrievedNotCited ? (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Retrieved, not cited, in {s.retrievedNotCited} more
                    </span>
                  ) : null}
                </td>
                <td className="p-3 tabular-nums">{s.answers}</td>
                <td className="min-w-40 p-3">
                  <OutcomeBar counts={s.outcomes} />
                </td>
                <td className="p-3 tabular-nums">
                  {pct(s.recommended.rate)}{" "}
                  <span className="text-xs text-muted-foreground">
                    {ofText(s.recommended)} read
                  </span>
                </td>
                <td className="p-3">
                  <span className="flex flex-col gap-0.5 text-xs">
                    {s.engines.map((e) => (
                      <EngineLabel key={e} engine={e} />
                    ))}
                  </span>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td
                  colSpan={5}
                  className="p-6 text-center text-muted-foreground"
                >
                  No sources of this type in these answers.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {data.brand ? (
        <SourceSheet
          projectId={projectId}
          filters={filters}
          brandDomain={data.brand.domain}
          source={open}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  );
}
