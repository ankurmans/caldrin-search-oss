import { useState } from "react";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  decideClaimSource,
  fetchClaimEvidence,
  type readClaimEvidence,
} from "@/serverFunctions/ai-claims";

export function ClaimSourceCards({
  evidence,
  loading,
  error,
  reviewer,
  data,
  busy,
  run,
}: {
  evidence: Awaited<ReturnType<typeof readClaimEvidence>> | undefined;
  loading: boolean;
  error: Error | null;
  reviewer: boolean;
  data: { projectId: string; id: string };
  busy: boolean;
  run: (work: () => Promise<unknown>) => void;
}) {
  const [passage, setPassage] = useState("");
  return (
    <div className="space-y-2 border-t pt-3 text-sm">
      <h3 className="font-medium">Source evidence</h3>
      <p className="text-muted-foreground">
        A source can corroborate an assertion. Its presence alone does not
        explain the answer.
      </p>
      {reviewer && (
        <Input
          aria-label="Exact passage to look for"
          placeholder="Exact passage to look for"
          value={passage}
          maxLength={240}
          onChange={(e) => setPassage(e.target.value)}
        />
      )}
      {loading && <p>Loading evidence…</p>}
      {error && <p role="alert">{getStandardErrorMessage(error)}</p>}
      {evidence?.sources.map((source) => (
        <div
          key={`${source.type}:${source.url}`}
          className="space-y-1 rounded-md border p-2"
        >
          <p className="text-xs text-muted-foreground">{source.type}</p>
          <a
            href={source.url}
            className="break-all underline"
            target="_blank"
            rel="noreferrer"
          >
            {source.title || source.url}
          </a>
          {source.snapshot && (
            <p className="text-xs">
              {source.snapshot.fetchedAt.slice(0, 10)}
              {source.snapshot.httpStatus
                ? ` · HTTP ${source.snapshot.httpStatus}`
                : ""}
              {source.snapshot.reason
                ? ` · ${source.snapshot.reason.replaceAll("_", " ")}`
                : ""}
            </p>
          )}
          {source.snapshot &&
            evidence?.sourceReviews
              .filter((review) => review.snapshotId === source.snapshot?.id)
              .slice(0, 3)
              .map((review) => (
                <p key={review.id} className="text-xs">
                  {review.relation.replaceAll("_", " ")} ·{" "}
                  {review.relevance.replaceAll("_", " ")} · {review.rationale}
                </p>
              ))}
          {source.snapshot?.matchingPassage && (
            <p>
              <strong>Matching passage</strong> ·{" "}
              {source.snapshot.matchingPassage}
            </p>
          )}
          {source.snapshot?.excerpt && (
            <blockquote className="break-words border-l pl-2">
              {source.snapshot.excerpt}
            </blockquote>
          )}
          {reviewer &&
            source.snapshot &&
            source.snapshot.reason !== "fetch_pending" && (
              <details className="my-2">
                <summary>Review source</summary>
                <form
                  className="my-2 space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const values = new FormData(event.currentTarget);
                    const rationale = values.get("rationale");
                    const relation = values.get("relation");
                    if (
                      relation !== "corroborating" &&
                      relation !== "conflicting" &&
                      relation !== "potentially_stale" &&
                      relation !== "insufficient"
                    )
                      return;
                    const snapshotId = source.snapshot!.id;
                    const relevance =
                      values.get("relevance") === "direct"
                        ? "direct"
                        : "context_only";
                    run(() =>
                      decideClaimSource({
                        data: {
                          ...data,
                          snapshotId,
                          relation,
                          relevance,
                          rationale:
                            typeof rationale === "string" ? rationale : "",
                        },
                      }),
                    );
                  }}
                >
                  <select
                    name="relation"
                    aria-label="Evidence relationship"
                    className="rounded-md border bg-background px-2 py-1"
                  >
                    <option value="insufficient">Insufficient evidence</option>
                    {source.snapshot.excerpt && (
                      <>
                        <option value="corroborating">
                          Corroborating evidence
                        </option>
                        <option value="conflicting">
                          Conflicting evidence
                        </option>
                        <option value="potentially_stale">
                          Potentially stale information
                        </option>
                      </>
                    )}
                  </select>
                  <select
                    name="relevance"
                    aria-label="Evidence relevance"
                    className="rounded-md border bg-background px-2 py-1"
                  >
                    <option value="context_only">Context only</option>
                    <option value="direct">Directly related</option>
                  </select>
                  <Input
                    name="rationale"
                    aria-label="Review rationale"
                    placeholder="Why this passage matters"
                    required
                    minLength={8}
                    maxLength={500}
                  />
                  <Button type="submit" size="sm" disabled={busy}>
                    Save source review
                  </Button>
                </form>
              </details>
            )}
          {reviewer && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || passage.trim().length < 5}
              onClick={() =>
                run(() =>
                  fetchClaimEvidence({
                    data: { ...data, url: source.url, passage },
                  }),
                )
              }
            >
              Read page
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
