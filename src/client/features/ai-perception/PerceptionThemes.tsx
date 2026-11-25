import { useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { EngineLabel } from "@/client/features/ai-visibility/EngineLabel";
import { HighlightedAnswerById } from "@/client/features/ai-visibility/HighlightedAnswerLoader";
import {
  ofText,
  pct,
} from "@/client/features/ai-visibility/insights/insightsShared";
import {
  AiLoading,
  AiQueryError,
} from "@/client/features/ai-visibility/shared";
import type {
  AiPerceptionSources,
  PerceptionTheme,
} from "@/shared/ai-perception-sources";

const KIND_LABEL = {
  objection: "Reasons to hesitate or check first",
  weakness: "Flaws the answers state",
  strength: "Strengths credited",
} as const;

function Theme({
  projectId,
  theme,
}: {
  projectId: string;
  theme: PerceptionTheme;
}) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  return (
    <li className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{theme.label}</p>
        <p className="text-sm tabular-nums text-muted-foreground">
          {pct(theme.answers.rate)} · {ofText(theme.answers)} read mentions ·{" "}
          {theme.prompts} {theme.prompts === 1 ? "prompt" : "prompts"}
        </p>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${theme.answers.numerator} of ${theme.answers.denominator} read mentions`}
      >
        <div
          className="h-full bg-rose-500 dark:bg-rose-400"
          style={{ width: `${(theme.answers.rate ?? 0) * 100}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {theme.engines.map((e) => (
          <EngineLabel key={e} engine={e} />
        ))}
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide evidence" : "Show evidence"}
        </Button>
      </div>
      {open ? (
        <ul className="space-y-3">
          {theme.examples.map((x) => (
            <li key={x.observationId} className="space-y-1 text-sm">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <EngineLabel engine={x.engine} />
              </p>
              <blockquote className="border-l-2 pl-3 italic text-muted-foreground">
                “{x.quote}”
              </blockquote>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setShown((cur) =>
                    cur === x.observationId ? null : x.observationId,
                  )
                }
              >
                {shown === x.observationId
                  ? "Hide full answer"
                  : "Show full answer"}
              </Button>
              {shown === x.observationId ? (
                <HighlightedAnswerById
                  projectId={projectId}
                  observationId={x.observationId}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function PerceptionThemes({
  projectId,
  query,
}: {
  projectId: string;
  query: UseQueryResult<AiPerceptionSources>;
}) {
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
  const themes = query.data.themes;
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-medium">What answers hold against you</h2>
        <p className="text-sm text-muted-foreground">
          Flaws and reasons to hesitate that answers give for{" "}
          {query.data.brand?.name ?? "the brand"}, grouped by similar wording.
          Each count is distinct answers over the read mentions, and every group
          keeps the exact words from the answers.
        </p>
      </div>
      {!themes.length ? (
        <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          {query.data.notes[0] ??
            "No flaws or objections were stated about this brand in the read answers."}
        </p>
      ) : (
        (["objection", "weakness"] as const).map((kind) => {
          const list = themes.filter((t) => t.kind === kind);
          return list.length ? (
            <div key={kind} className="space-y-2">
              <h3 className="text-sm font-medium">{KIND_LABEL[kind]}</h3>
              <ul className="space-y-2">
                {list.map((t) => (
                  <Theme key={t.id} projectId={projectId} theme={t} />
                ))}
              </ul>
            </div>
          ) : null;
        })
      )}
    </section>
  );
}
