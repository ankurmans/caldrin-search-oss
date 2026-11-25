import { Badge } from "@/client/components/ui/badge";
import {
  FormulaNote,
  ofText,
  pct,
  shortDate,
  type InsightsFilters,
} from "@/client/features/ai-visibility/insights/insightsShared";
import type {
  PerceptionBrandView,
  AiPerceptionView,
} from "@/shared/ai-perception-view";
import {
  PERCEPTION_SENTIMENTS,
  PERCEPTION_STANCES,
} from "@/shared/ai-perception";

import { PerceptionExportButton } from "./PerceptionExportButton";

const SEGMENT: Record<string, string> = {
  recommended: "bg-emerald-500 dark:bg-emerald-400",
  described: "bg-slate-400 dark:bg-slate-500",
  discouraged: "bg-rose-500 dark:bg-rose-400",
  positive: "bg-emerald-500 dark:bg-emerald-400",
  neutral: "bg-slate-400 dark:bg-slate-500",
  negative: "bg-rose-500 dark:bg-rose-400",
  mixed: "bg-amber-400 dark:bg-amber-500",
};

function Split({
  title,
  counts,
  keys,
}: {
  title: string;
  counts: Record<string, number>;
  keys: readonly string[];
}) {
  const total = keys.reduce((sum, k) => sum + (counts[k] ?? 0), 0);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">{total} read</span>
      </div>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={keys.map((k) => `${counts[k] ?? 0} ${k}`).join(", ")}
      >
        {keys.map((k) =>
          counts[k] ? (
            <div
              key={k}
              className={SEGMENT[k]}
              style={{ width: `${(counts[k] / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        {keys.map((k) => (
          <li key={k} className="flex items-center gap-1">
            <span className={`size-2 rounded-sm ${SEGMENT[k]}`} />
            {k} <span className="tabular-nums">{counts[k] ?? 0}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({
  label,
  value,
  note,
  formula,
}: {
  label: string;
  value: { numerator: number; denominator: number; rate: number | null };
  note: string;
  formula: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="flex items-center gap-1 text-muted-foreground">
        {label}
        <FormulaNote label={label} text={formula} />
      </span>
      <span className="text-right">
        <span className="font-medium tabular-nums">{pct(value.rate)}</span>{" "}
        <span className="text-xs text-muted-foreground">
          {ofText(value)} {note}
        </span>
      </span>
    </div>
  );
}

function BrandCard({
  brand,
  projectId,
  filters,
  disabled,
}: {
  brand: PerceptionBrandView;
  projectId: string;
  filters: InsightsFilters;
  disabled: boolean;
}) {
  const change = brand.change;
  return (
    <article className="space-y-4 rounded-xl border bg-card p-4 md:p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{brand.name}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {brand.domain}
          </p>
        </div>
        {brand.own ? <Badge>Your brand</Badge> : null}
        <PerceptionExportButton
          projectId={projectId}
          filters={filters}
          domain={brand.domain}
          brandName={brand.name}
          disabled={disabled}
        />
      </header>
      <div className="space-y-2">
        <Row
          label="Named"
          value={brand.mention}
          note="answers"
          formula="Answers that name the brand, over answers with text."
        />
        <Row
          label="Recommended"
          value={brand.recommendedOfMentions}
          note="read mentions"
          formula="Mentions read as recommended, over mentions that have a reading. Unread mentions are excluded."
        />
        <Row
          label="Discouraged"
          value={brand.discouragedOfMentions}
          note="read mentions"
          formula="Mentions read as discouraged, over mentions that have a reading."
        />
        <Row
          label="Recommended, all answers"
          value={brand.recommendedOfAnswers}
          note="answers"
          formula="Mentions read as recommended, over every answer with text, so answers that do not name the brand count against it."
        />
      </div>
      <Split title="Stance" counts={brand.stance} keys={PERCEPTION_STANCES} />
      <Split
        title="Sentiment"
        counts={brand.sentiment}
        keys={PERCEPTION_SENTIMENTS}
      />
      <footer className="space-y-1 text-xs text-muted-foreground">
        {brand.unread ? (
          <p>
            {brand.unread} named, not read yet (left out of the rates above).
          </p>
        ) : null}
        {brand.corrected ? (
          <p>{brand.corrected} readings corrected by a person.</p>
        ) : null}
        {brand.ambiguous ? (
          <p>
            {brand.ambiguous} readings where the name could mean something else.
          </p>
        ) : null}
        {change && change.difference !== null ? (
          <p>
            Recommended rate {change.difference > 0 ? "+" : ""}
            {Math.round(change.difference * 100)} pts against the previous
            window ({ofText(change.previous)}); {change.verdict}.
          </p>
        ) : null}
      </footer>
    </article>
  );
}

export function PerceptionBrands({
  view,
  projectId,
  filters,
  disabled,
}: {
  view: AiPerceptionView;
  projectId: string;
  filters: InsightsFilters;
  disabled: boolean;
}) {
  if (!view.brands.length) {
    return (
      <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        No answers with text in this window. Run a visibility check first.
      </p>
    );
  }
  const own = view.brands.find((brand) => brand.own);
  const { previous, reason } = view.sentimentComparison;
  return (
    <section className="space-y-3">
      {own ? (
        <section className="space-y-3 rounded-xl border bg-card p-4 md:p-5">
          <h2 className="text-base font-medium">Sentiment by period</h2>
          {previous ? (
            <>
              <p className="text-xs text-muted-foreground">
                Tone in saved answers that mention {own.name}. Counts show what
                was read in each period.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <Split
                  title={`Previous · ${shortDate(previous.start)} to ${shortDate(previous.end)}`}
                  counts={previous.counts}
                  keys={PERCEPTION_SENTIMENTS}
                />
                <Split
                  title={`Current · ${shortDate(view.population.window.start)} to ${shortDate(view.population.window.end)}`}
                  counts={own.sentiment}
                  keys={PERCEPTION_SENTIMENTS}
                />
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{reason}</p>
          )}
        </section>
      ) : null}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-medium">By brand</h2>
        <p className="text-xs text-muted-foreground">
          Stance is what the answer tells a buyer to do; sentiment is its tone.
          They are counted separately.
        </p>
      </div>
      {view.comparison.reason && (!own || view.comparison.reason !== reason) ? (
        <p className="text-xs text-muted-foreground">
          {view.comparison.reason}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {view.brands.map((b) => (
          <BrandCard
            key={b.domain}
            brand={b}
            projectId={projectId}
            filters={filters}
            disabled={disabled}
          />
        ))}
      </div>
    </section>
  );
}
