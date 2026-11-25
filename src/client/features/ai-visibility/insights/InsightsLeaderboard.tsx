import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sort as sortBy } from "remeda";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { classifyAiVisibilitySentiment } from "@/serverFunctions/ai-visibility";
import { aiVisibilityKey } from "../shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { AI_ENGINE_LABELS } from "@/shared/ai-visibility";
import {
  INTEL_FORMULAS,
  type AiVisibilityIntelligence,
  type IntelBrand,
} from "@/shared/ai-visibility-intelligence";
import { EngineIcon } from "../EngineIcon";
import { FormulaNote, ofText, pct } from "./insightsShared";

type SortKey =
  | "visibility"
  | "shareOfVoice"
  | "position"
  | "citation"
  | "recommendation"
  | "answers";

const VALUE: Record<SortKey, (b: IntelBrand) => number | null> = {
  visibility: (b) => b.visibility,
  shareOfVoice: (b) => b.shareOfVoice.rate,
  // Lower is better: sort first places first.
  position: (b) => (b.avgPosition.value === null ? null : -b.avgPosition.value),
  citation: (b) => b.citationAmongMentioned.rate,
  recommendation: (b) => b.recommendation.rate,
  answers: (b) => b.answers,
};

const VERDICT_LABEL = {
  outside_noise: "Beyond run-to-run noise",
  within_noise: "Within run-to-run noise",
  insufficient_runs: "Too few runs to judge",
  not_assessable: "Not assessable",
} as const;

function Change({ brand }: { brand: IntelBrand }) {
  const change = brand.change;
  if (!change || change.difference === null)
    return <span className="text-muted-foreground">—</span>;
  const points = Math.round(change.difference * 100);
  return (
    <span className="whitespace-nowrap" title={VERDICT_LABEL[change.verdict]}>
      <span className="tabular-nums">
        {points > 0 ? "+" : ""}
        {points} pts
      </span>
      {change.verdict !== "outside_noise" ? (
        <span className="ml-1 text-xs text-muted-foreground">
          ({VERDICT_LABEL[change.verdict].toLowerCase()})
        </span>
      ) : null}
    </span>
  );
}

function Sentiment({ brand }: { brand: IntelBrand }) {
  const s = brand.sentiment;
  if (!s) return <span className="text-muted-foreground">Not measured</span>;
  const parts = [
    s.positive && `${s.positive} positive`,
    s.neutral && `${s.neutral} neutral`,
    s.negative && `${s.negative} negative`,
    s.mixed && `${s.mixed} mixed`,
  ].filter(Boolean);
  return (
    <span className="text-xs tabular-nums">
      {parts.join(" · ")}
      <span className="block text-muted-foreground">
        of {s.classified} labeled ({s.mentioned} naming it)
      </span>
    </span>
  );
}

function SortHead({
  label,
  formula,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  formula?: string;
  sortKey: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <TableHead
      aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
      className="whitespace-nowrap"
    >
      <span className="inline-flex items-center gap-0.5">
        <button
          type="button"
          className="inline-flex items-center gap-1 hover:text-foreground"
          onClick={() => onSort(sortKey)}
        >
          {label}
          {active ? (
            sort.desc ? (
              <ArrowDown className="size-3" />
            ) : (
              <ArrowUp className="size-3" />
            )
          ) : null}
        </button>
        {formula ? <FormulaNote label={label} text={formula} /> : null}
      </span>
    </TableHead>
  );
}

function Ratio({
  rate,
  empty,
}: {
  rate: IntelBrand["mention"];
  empty: string;
}) {
  if (rate.rate === null)
    return <span className="text-muted-foreground">{empty}</span>;
  return (
    <span className="tabular-nums">
      {pct(rate.rate)}
      <span className="block text-xs text-muted-foreground">
        {ofText(rate)}
      </span>
    </span>
  );
}

function LabelSentiment({
  projectId,
  runId,
}: {
  projectId: string;
  runId: string;
}) {
  const queryClient = useQueryClient();
  const label = useMutation({
    mutationFn: () =>
      classifyAiVisibilitySentiment({ data: { projectId, runId } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: aiVisibilityKey(projectId) }),
  });
  return (
    <div className="flex items-center gap-2">
      {label.data ? (
        <span className="text-xs text-muted-foreground">
          Read {label.data.readingsSaved} brand mentions
          {label.data.remaining ? `, ${label.data.remaining} answers left` : ""}
        </span>
      ) : null}
      {label.isError ? (
        <span className="text-xs text-destructive">
          Could not label answers
        </span>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        disabled={label.isPending}
        onClick={() => label.mutate()}
      >
        {label.isPending ? "Labeling…" : "Label sentiment (latest run)"}
      </Button>
    </div>
  );
}

export function InsightsLeaderboard({
  projectId,
  data,
  selected,
  onSelect,
}: {
  projectId: string;
  data: AiVisibilityIntelligence;
  selected: string | null;
  onSelect: (domain: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "visibility",
    desc: true,
  });
  const onSort = (key: SortKey) =>
    setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }));
  const rows = sortBy(data.leaderboard, (a, b) => {
    const va = VALUE[sort.key](a);
    const vb = VALUE[sort.key](b);
    if (va === null && vb === null) return a.name.localeCompare(b.name);
    if (va === null) return 1;
    if (vb === null) return -1;
    return sort.desc ? vb - va : va - vb;
  });
  const head = { sort, onSort };
  return (
    <section
      className="space-y-3 rounded-xl border bg-card p-4 md:p-6"
      aria-label="Competitor leaderboard"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">Tracked brands</h3>
        <p className="text-xs text-muted-foreground">
          Select a brand to see the prompts and answers behind its numbers.
        </p>
        {data.trend.length ? (
          <LabelSentiment
            projectId={projectId}
            runId={data.trend[data.trend.length - 1].runId}
          />
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Brand</TableHead>
              <SortHead
                label="Visibility"
                formula={INTEL_FORMULAS.visibility}
                sortKey="visibility"
                {...head}
              />
              <SortHead
                label="Share of voice"
                formula={INTEL_FORMULAS.shareOfVoice}
                sortKey="shareOfVoice"
                {...head}
              />
              <SortHead
                label="Avg. position"
                formula={INTEL_FORMULAS.position}
                sortKey="position"
                {...head}
              />
              <SortHead
                label="Citation rate (when named)"
                formula={INTEL_FORMULAS.citationAmongMentioned}
                sortKey="citation"
                {...head}
              />
              <SortHead
                label="Recommended"
                formula={INTEL_FORMULAS.recommendation}
                sortKey="recommendation"
                {...head}
              />
              <TableHead className="whitespace-nowrap">
                <span className="inline-flex items-center gap-0.5">
                  Sentiment
                  <FormulaNote
                    label="Sentiment"
                    text={INTEL_FORMULAS.sentiment}
                  />
                </span>
              </TableHead>
              <SortHead label="Sample" sortKey="answers" {...head} />
              <TableHead>By engine</TableHead>
              <TableHead className="whitespace-nowrap">
                vs previous {data.window.days} days
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((brand) => (
              <TableRow
                key={brand.domain}
                data-state={selected === brand.domain ? "selected" : undefined}
                className="cursor-pointer"
                onClick={() => onSelect(brand.domain)}
              >
                <TableCell className="min-w-44">
                  <button
                    type="button"
                    className="text-left font-medium hover:underline"
                    aria-label={`Show evidence for ${brand.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(brand.domain);
                    }}
                  >
                    {brand.rank ? `${brand.rank}. ` : ""}
                    {brand.name}
                  </button>
                  {brand.own ? (
                    <Badge variant="secondary" size="sm" className="ml-2">
                      You
                    </Badge>
                  ) : null}
                  <span className="block text-xs text-muted-foreground">
                    {brand.domain}
                  </span>
                </TableCell>
                <TableCell className="font-medium tabular-nums">
                  {pct(brand.visibility)}
                </TableCell>
                <TableCell>
                  <Ratio rate={brand.shareOfVoice} empty="—" />
                </TableCell>
                <TableCell className="tabular-nums">
                  {brand.avgPosition.value === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <>
                      {brand.avgPosition.value.toFixed(1)}
                      <span className="block text-xs text-muted-foreground">
                        over {brand.avgPosition.answers} answers
                      </span>
                    </>
                  )}
                </TableCell>
                <TableCell>
                  <Ratio
                    rate={brand.citationAmongMentioned}
                    empty="Not named"
                  />
                </TableCell>
                <TableCell>
                  <Ratio rate={brand.recommendation} empty="Not named" />
                </TableCell>
                <TableCell>
                  <Sentiment brand={brand} />
                </TableCell>
                <TableCell className="tabular-nums">
                  {brand.answers}
                  <span className="block text-xs text-muted-foreground">
                    answers · {brand.prompts} prompts
                  </span>
                </TableCell>
                <TableCell>
                  <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {brand.byEngine.map((e) => (
                      <li
                        key={e.engine}
                        className="inline-flex items-center gap-1 tabular-nums"
                        title={`${AI_ENGINE_LABELS[e.engine]}: named in ${e.mentions} of ${e.answers}`}
                      >
                        <EngineIcon
                          engine={e.engine}
                          className="size-3.5"
                          aria-hidden
                        />
                        <span className="sr-only">
                          {AI_ENGINE_LABELS[e.engine]}
                        </span>
                        {pct(e.visibility)}
                      </li>
                    ))}
                  </ul>
                </TableCell>
                <TableCell>
                  <Change brand={brand} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {!data.comparison.comparable && data.comparison.reason ? (
        <p className="text-xs text-muted-foreground">
          {data.comparison.reason}
        </p>
      ) : null}
    </section>
  );
}
