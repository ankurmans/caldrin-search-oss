import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/client/components/ui/button";
import { formatRelativeTime } from "@/client/lib/relative-time";
import {
  Pulse,
  PulseNumber,
  PulseUnavailable,
} from "@/client/features/command-centre/Pulse";
import {
  formatPercent,
  signed,
  type CommandCentreData,
} from "@/client/features/command-centre/helpers";

const VERDICT_NOTE = {
  within_noise: "within run-to-run noise",
  outside_noise: "beyond run-to-run noise",
  insufficient_runs: "too few runs to judge",
  not_assessable: "not assessable",
} as const;

export function AiPulse({
  projectId,
  ai,
}: {
  projectId: string;
  ai: CommandCentreData["ai"];
}) {
  const link = (
    <Link
      to="/p/$projectId/ai-visibility/insights"
      params={{ projectId }}
      className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
    >
      Details
    </Link>
  );
  let body;
  let details: ReactNode;
  if (ai === null) {
    body = (
      <PulseUnavailable message="AI visibility is unavailable right now." />
    );
  } else if (!ai.configured) {
    body = (
      <PulseUnavailable
        message="No prompts are tracked yet."
        action={
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={
              <Link
                to="/p/$projectId/ai-visibility/research"
                params={{ projectId }}
              />
            }
          >
            Set up AI visibility
          </Button>
        }
      />
    );
  } else if (ai.answered === 0) {
    body = (
      <PulseUnavailable message="No answers collected in the last 28 days." />
    );
  } else {
    const difference = ai.change?.difference ?? null;
    const note =
      ai.change && ai.comparable
        ? `${
            difference === null
              ? "change not assessable"
              : signed(Math.round(difference * 100), " pts")
          } vs prior${
            ai.change.verdict === "outside_noise"
              ? ""
              : `, ${VERDICT_NOTE[ai.change.verdict]}`
          }`
        : ai.comparable
          ? null
          : "not comparable to prior period";
    const snapshot = ai.repeatRunLevel !== "adequate";
    body = (
      <>
        <dl className="grid grid-cols-2 gap-3 @min-[30rem]/pulse:grid-cols-4">
          <PulseNumber
            label="Visibility"
            value={formatPercent(ai.visibility)}
            note={note}
          />
          <PulseNumber
            label="Citation"
            value={formatPercent(ai.citedAnswers?.rate ?? null)}
          />
          <PulseNumber
            label="Recommended"
            value={
              ai.recommended
                ? formatPercent(
                    ai.recommended.numerator / ai.recommended.denominator,
                  )
                : "—"
            }
            note={
              ai.recommended
                ? `of ${ai.recommended.denominator} read`
                : "not read yet"
            }
          />
          <PulseNumber
            label="Rank"
            value={ai.rank ? `#${ai.rank}` : "—"}
            note={ai.rank ? `of ${ai.brandsCompared} brands` : undefined}
          />
        </dl>
        <p className="text-xs text-muted-foreground">
          {ai.answered} answers · {ai.trackedPrompts} prompts ·{" "}
          {ai.engines.length} {ai.engines.length === 1 ? "engine" : "engines"} ·{" "}
          {ai.contributingRuns} {ai.contributingRuns === 1 ? "run" : "runs"}
          {snapshot ? " · snapshot, not a trend" : ""}
          {ai.lastRunAt ? ` · checked ${formatRelativeTime(ai.lastRunAt)}` : ""}
        </p>
      </>
    );
    details = (
      <ul className="list-disc space-y-1.5 pl-4">
        <li>
          Share of {ai.answered} collected answers in the last 28 days, from{" "}
          {ai.trackedPrompts} tracked prompts across {ai.engines.length}{" "}
          {ai.engines.length === 1 ? "engine" : "engines"}
          {ai.engines.length > 0 ? ` (${ai.engines.join(", ")})` : ""}.
        </li>
        <li>
          Visibility is the share of answers that mention you. Citation is the
          share that cite your site. Rank orders the {ai.brandsCompared} brands
          compared by visibility.
        </li>
        <li>
          {ai.contributingRuns} {ai.contributingRuns === 1 ? "run" : "runs"}{" "}
          contribute.{" "}
          {snapshot
            ? "Too few repeated runs to call a trend; read it as a snapshot."
            : "Repeated runs are enough to judge movement against run-to-run noise."}
        </li>
        <li>
          {ai.comparable
            ? "The prior period used the same prompts and engines, so the change is comparable."
            : (ai.comparisonNote ??
              "The prior period used a different prompt set or engines, so no change is shown.")}
        </li>
        <li>
          {ai.lastRunAt
            ? `Last run ${formatRelativeTime(ai.lastRunAt)}.`
            : "No run has finished yet."}
        </li>
      </ul>
    );
  }
  return (
    <Pulse
      title="AI Visibility"
      source="Collected AI answers · 28 days"
      details={details}
      action={link}
    >
      {body}
    </Pulse>
  );
}
