import { Link } from "@tanstack/react-router";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  COLLECTION_MODE_LABELS,
  RECOMMENDATION_LABELS,
  ROOT_CAUSE_LABELS,
  type EvidenceLevel,
  type SourceGapAnalysis,
} from "@/shared/source-gap";
import { CandidateCards, OwnerOutcome } from "./SourceGapOwnerCards";
import {
  CitedSources,
  ConsensusList,
  DifferenceMatrix,
} from "./SourceGapSections";
import { ageLabel, shortUrl } from "./sourceGapShared";

const LEVEL_LABEL: Record<EvidenceLevel, string> = {
  observed: "Observed",
  inferred: "Inferred",
  hypothesis: "Hypothesis to test",
};
const PRIORITY_VARIANT = {
  high: "destructive",
  medium: "secondary",
  low: "outline",
} as const;

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2" aria-label={title}>
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

/** One stored Source Gap analysis. It only reads the analysis it is given. */
export function SourceGapView({
  analysis,
  projectId,
  ownerPicker,
  opportunityButton,
  busy,
  onRetry,
  onChoose,
}: {
  analysis: SourceGapAnalysis;
  projectId: string;
  busy: boolean;
  onRetry: (url: string) => void;
  onChoose: (url: string) => void;
  ownerPicker: React.ReactNode;
  opportunityButton: React.ReactNode;
}) {
  const { owner, stats } = analysis;
  const readable = analysis.sources.filter(
    (s) => s.sourceType !== "own" && s.snapshot?.status === "ok",
  ).length;
  const missing = analysis.consensus.filter(
    (p) => p.yours === false && p.citedCount >= 2,
  );
  missing.sort((a, b) => b.citedCount - a.citedCount);
  const gaps = missing.slice(0, 5);
  return (
    <div className="space-y-6">
      <section
        className="space-y-1 text-sm text-muted-foreground"
        aria-label="What this is based on"
      >
        <p>
          {stats.answers} stored answer(s) from {analysis.runIds.length} run(s),
          analyzed {ageLabel(analysis.createdAt)}. You were named in{" "}
          {stats.ownMentions} and cited in {stats.ownCitations}; a competitor
          was named in {stats.competitorMentions}, and in{" "}
          {stats.answersWithCompetitorOnly} without you.
        </p>
        <p className="text-xs">
          Collection: {COLLECTION_MODE_LABELS[analysis.collectionMode]}. These
          findings describe these runs and engines, not every AI product.
        </p>
      </section>

      {analysis.changes.length ? (
        <Section title="Changed since the last analysis">
          <ul className="list-disc space-y-0.5 pl-4 text-sm">
            {analysis.changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Cited sources">
        <CitedSources sources={analysis.sources} />
      </Section>

      <Section title="Your closest page">
        <OwnerOutcome owner={owner} />
        {owner.selected ? (
          <div className="space-y-1 rounded-lg border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={owner.confidence === "low" ? "outline" : "secondary"}
              >
                {owner.overridden
                  ? "Manually selected, not checked by Caldrin"
                  : `${owner.confidence} confidence`}
              </Badge>
              {analysis.ownerSnapshot ? (
                <span className="text-xs text-muted-foreground">
                  Read {ageLabel(analysis.ownerSnapshot.fetchedAt)}
                </span>
              ) : null}
            </div>
            <a
              href={owner.selected.url}
              target="_blank"
              rel="noreferrer"
              className="block text-sm font-medium break-all underline-offset-2 hover:underline"
            >
              {owner.selected.title || shortUrl(owner.selected.url)}
            </a>
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
              {owner.selected.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm">
            <Badge variant="outline">No page confirmed</Badge> No page on your
            site is confirmed as the page for this prompt.
          </p>
        )}
        {owner.notes.map((n) => (
          <p key={n} className="text-xs text-muted-foreground">
            {n}
          </p>
        ))}
        <CandidateCards
          owner={owner}
          busy={busy}
          onRetry={onRetry}
          onChoose={onChoose}
        />
        {ownerPicker}
      </Section>

      <Section title="Why these sources won">
        <p className="text-xs text-muted-foreground">
          Counts are over the {readable} cited page(s) that could be read.
        </p>
        {gaps.length ? (
          <>
            <p className="text-sm font-medium">Where your page differs</p>
            <ConsensusList patterns={gaps} hasOwner />
          </>
        ) : null}
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            All patterns across cited pages
          </summary>
          <div className="pt-2">
            <ConsensusList
              patterns={analysis.consensus}
              hasOwner={!!owner.selected}
            />
          </div>
        </details>
      </Section>

      <Section title="Findings">
        <ul className="space-y-2">
          {analysis.rootCauses.map((c) => (
            <li key={c.category} className="space-y-1 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {ROOT_CAUSE_LABELS[c.category]}
                </span>
                <Badge variant="outline">{LEVEL_LABEL[c.level]}</Badge>
                <span className="text-xs text-muted-foreground">
                  {c.confidence} confidence
                </span>
              </div>
              <p className="text-sm">{c.evidence}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Recommended actions">
        {analysis.recommendations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No page change is recommended from this analysis.
          </p>
        ) : (
          <ul className="space-y-2">
            {analysis.recommendations.map((r) => (
              <li
                key={`${r.action}-${r.rootCause}`}
                className="space-y-1 rounded-lg border p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {RECOMMENDATION_LABELS[r.action]}
                  </span>
                  <Badge variant={PRIORITY_VARIANT[r.priority]}>
                    {r.priority} priority
                  </Badge>
                  <Badge variant="outline">{LEVEL_LABEL[r.level]}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {r.effort} effort
                    {r.dependency === "third_party"
                      ? " · needs other sites"
                      : ""}
                  </span>
                </div>
                <p className="text-sm">{r.reason}</p>
                <p className="text-xs text-muted-foreground">
                  {r.expectedEffect}
                </p>
                <p className="text-xs text-muted-foreground">
                  Why this priority: {r.priorityReason}
                </p>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {analysis.opportunityId ? (
            <Button
              size="sm"
              variant="secondary"
              nativeButton={false}
              render={
                <Link to="/p/$projectId/opportunities" params={{ projectId }} />
              }
            >
              In Search Opportunities
            </Button>
          ) : (
            opportunityButton
          )}
        </div>
      </Section>

      <Section title="Source difference matrix">
        <DifferenceMatrix differences={analysis.differences} />
      </Section>

      <Section title="Confidence and measurement caveats">
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
          {analysis.measurementNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
