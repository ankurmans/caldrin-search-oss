import { ClaimCorrections } from "./ClaimCorrections";
import { ClaimSourceCards } from "./ClaimSourceCards";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  compareClaimFacts,
  getClaimGroupSuggestions,
  decideClaimAssessment,
  readClaimEvidence,
  regroupClaim,
  type getClaimOverview,
} from "@/serverFunctions/ai-claims";

type Cluster = Awaited<ReturnType<typeof getClaimOverview>>["clusters"][number];
const labels = {
  consistent: "Consistent with approved facts",
  conflict: "Conflicts with approved facts",
  mixed: "Approved facts disagree",
  insufficient: "Insufficient evidence",
};

export function ClaimEvidencePanel({
  projectId,
  cluster,
  reviewer,
  refresh,
}: {
  projectId: string;
  cluster: Cluster;
  reviewer: boolean;
  refresh: () => void;
}) {
  const [selected, select] = useState(cluster.occurrences[0].occurrenceId);
  const [target, setTarget] = useState("");
  const answer =
    cluster.occurrences.find((row) => row.occurrenceId === selected) ??
    cluster.occurrences[0];
  const data = { projectId, id: answer.occurrenceId };
  const evidence = useQuery({
    queryKey: ["claim-evidence", projectId, data.id],
    queryFn: () => readClaimEvidence({ data }),
  });
  const groups = useQuery({
    queryKey: ["claim-group-suggestions", projectId, answer.claimId],
    queryFn: () =>
      getClaimGroupSuggestions({ data: { projectId, id: answer.claimId } }),
    enabled: reviewer,
  });
  const action = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => {
      await work();
    },
    onSuccess: () => {
      void evidence.refetch();
      if (reviewer) void groups.refetch();
      refresh();
    },
  });
  const trend = new Map<string, number>();
  for (const date of cluster.dates) {
    const day = date.slice(0, 10);
    trend.set(day, (trend.get(day) ?? 0) + 1);
  }
  const peak = Math.max(1, ...trend.values());
  return (
    <section className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
      <div>
        <h2 className="font-semibold">
          {cluster.proposition.subject} · {cluster.proposition.predicate}
        </h2>
        <p className="text-sm">
          {cluster.proposition.polarity === "denies" ? "Denies " : ""}
          {cluster.proposition.value}
        </p>
        <p className="text-sm text-muted-foreground">
          {[
            cluster.proposition.product,
            cluster.proposition.plan,
            cluster.proposition.version,
            cluster.proposition.market,
            cluster.proposition.effectiveDate,
            cluster.proposition.condition,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      {trend.size > 0 && (
        <div className="space-y-1 text-xs">
          <h3 className="font-medium">Observed answers by day</h3>
          {[...trend].slice(-14).map(([day, count]) => (
            <div
              key={day}
              className="grid grid-cols-[6rem_1fr_2rem] items-center gap-2"
            >
              <span>{day}</span>
              <progress
                className="w-full accent-primary"
                max={peak}
                value={count}
                aria-label={`${day}: ${count} answers`}
              />
              <span>{count}</span>
            </div>
          ))}
        </div>
      )}
      <label className="block space-y-1 text-sm">
        <span>Original answer</span>
        <select
          className="h-9 w-full rounded-md border bg-background px-2"
          value={answer.occurrenceId}
          onChange={(event) => {
            select(event.target.value);
          }}
        >
          {cluster.occurrences.map((row) => (
            <option key={row.occurrenceId} value={row.occurrenceId}>
              {row.engine} ·{" "}
              {row.observedAt?.slice(0, 10) ?? "Date unavailable"} ·{" "}
              {row.prompt}
            </option>
          ))}
        </select>
      </label>
      <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm">
        {answer.quote || "Saved quote unavailable"}
      </blockquote>
      <p className="text-xs text-muted-foreground">
        {answer.engine} · {answer.model ?? "Model unavailable"} ·{" "}
        {answer.locationCode} / {answer.languageCode} · extraction confidence{" "}
        {Math.round(answer.confidence * 100)}%
      </p>
      <Link
        to="/p/$projectId/ai-visibility/prompts/$promptId"
        params={{ projectId, promptId: answer.promptId }}
        className="text-sm underline"
      >
        Open tracked prompt
      </Link>
      {cluster.alternatives.length > 0 && (
        <div className="space-y-1 rounded-md border p-2 text-sm">
          <h3 className="font-medium">Other assertions in scope</h3>
          {cluster.alternatives.map((item) => (
            <p key={item.id}>
              {item.polarity === "denies" ? "Denies " : ""}
              {item.value}
            </p>
          ))}
        </div>
      )}
      <div className="space-y-2 border-t pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">Fact assessment</h3>
          <Button
            size="sm"
            variant="outline"
            disabled={action.isPending}
            onClick={() => action.mutate(() => compareClaimFacts({ data }))}
          >
            Compare approved facts
          </Button>
        </div>
        {evidence.data?.history.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Compare this answer with dated, approved facts.
          </p>
        )}
        {evidence.data?.history.map((row) => (
          <div key={row.id} className="space-y-2 rounded-md border p-2 text-sm">
            <strong>{labels[row.status]}</strong>
            {row.review && (
              <span>
                {" "}
                · {row.review === "confirmed" ? "Human confirmed" : "Dismissed"}
              </span>
            )}
            <p>{row.rationale}</p>
            {row.review === "confirmed" && (
              <p className="text-muted-foreground">
                Next action: review the owned page and start a correction brief
                in Content Studio.
              </p>
            )}
            {row.facts.map((fact) => (
              <p key={fact.id} className="text-muted-foreground">
                {fact.predicate} · {fact.value} · effective {fact.effectiveFrom}
                <br />
                {fact.evidence}
              </p>
            ))}
            {row.review === "confirmed" && (
              <ClaimCorrections
                projectId={projectId}
                assessment={row}
                reviewer={reviewer}
              />
            )}
            {reviewer && !row.review && (
              <div className="flex flex-wrap gap-2">
                {row.status === "conflict" && (
                  <Button
                    size="sm"
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate(() =>
                        decideClaimAssessment({
                          data: { projectId, id: row.id, review: "confirmed" },
                        }),
                      )
                    }
                  >
                    Confirm conflict
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate(() =>
                      decideClaimAssessment({
                        data: { projectId, id: row.id, review: "dismissed" },
                      }),
                    )
                  }
                >
                  Dismiss
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
      <ClaimSourceCards
        key={data.id}
        evidence={evidence.data}
        loading={evidence.isPending}
        error={evidence.error}
        reviewer={reviewer}
        data={data}
        busy={action.isPending}
        run={(work) => action.mutate(work)}
      />
      {reviewer && (
        <details className="border-t pt-3 text-sm">
          <summary>Manage claim grouping</summary>
          {groups.data?.suggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              className="mt-2 space-y-1 rounded border p-2"
            >
              <strong>
                {suggestion.predicate} · {suggestion.value}
              </strong>
              <p>{suggestion.rationale}</p>
              <Button
                size="sm"
                variant="outline"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate(() =>
                    regroupClaim({
                      data: {
                        projectId,
                        id: answer.claimId,
                        target: suggestion.id,
                      },
                    }),
                  )
                }
              >
                Merge after review
              </Button>
            </div>
          ))}
          {groups.data?.history.map((event) => (
            <p key={event.id} className="text-xs text-muted-foreground">
              {event.createdAt.slice(0, 10)} ·{" "}
              {event.target ? "Merged" : "Separated"} ·{" "}
              {event.target ?? event.previousTarget}
            </p>
          ))}
          <p className="mt-2 break-all text-xs text-muted-foreground">
            Claim ID {answer.claimId}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input
              aria-label="Target claim ID"
              placeholder="Target claim ID"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={action.isPending || !target.trim()}
              onClick={() =>
                action.mutate(() =>
                  regroupClaim({
                    data: {
                      projectId,
                      id: answer.claimId,
                      target: target.trim(),
                    },
                  }),
                )
              }
            >
              Group variant
            </Button>
            {answer.claimId !== cluster.id && (
              <Button
                size="sm"
                variant="outline"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate(() =>
                    regroupClaim({
                      data: { projectId, id: answer.claimId, target: null },
                    }),
                  )
                }
              >
                Separate variant
              </Button>
            )}
          </div>
        </details>
      )}
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {getStandardErrorMessage(action.error)}
        </p>
      )}
    </section>
  );
}
