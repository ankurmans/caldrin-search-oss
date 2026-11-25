import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  checkClaimPublication,
  draftClaimCorrection,
  getClaimCorrections,
  recheckCorrection,
  reviewClaimCorrection,
  saveClaimClientReport,
  saveClaimFollowup,
  type readClaimEvidence,
} from "@/serverFunctions/ai-claims";

type Assessment = Awaited<
  ReturnType<typeof readClaimEvidence>
>["history"][number];
type Correction = Awaited<ReturnType<typeof getClaimCorrections>>[number];

export function ClaimCorrections({
  projectId,
  assessment,
  reviewer,
}: {
  projectId: string;
  assessment: Assessment;
  reviewer: boolean;
}) {
  const [kind, setKind] = useState<"owned" | "external">("owned");
  const [targetUrl, setTargetUrl] = useState("");
  const [factId, setFactId] = useState(assessment.facts[0]?.id ?? "");
  const query = useQuery({
    queryKey: ["claim-corrections", projectId, assessment.id],
    queryFn: () =>
      getClaimCorrections({ data: { projectId, id: assessment.id } }),
  });
  const refresh = () => {
    void query.refetch();
  };
  const draft = useMutation({
    mutationFn: () =>
      draftClaimCorrection({
        data: {
          projectId,
          assessmentId: assessment.id,
          targetUrl,
          kind,
          factId,
        },
      }),
    onSuccess: refresh,
  });
  return (
    <div className="space-y-3 border-t pt-3">
      <h4 className="font-medium">Correction workflow</h4>
      {reviewer && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            draft.mutate();
          }}
        >
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Correction type"
              className="rounded-md border bg-background px-2"
              value={kind}
              onChange={(event) =>
                setKind(
                  event.target.value === "external" ? "external" : "owned",
                )
              }
            >
              <option value="owned">Owned page</option>
              <option value="external">External source</option>
            </select>
            <select
              aria-label="Approved fact"
              className="rounded-md border bg-background px-2"
              value={factId}
              onChange={(event) => setFactId(event.target.value)}
            >
              {assessment.facts.map((fact) => (
                <option key={fact.id} value={fact.id}>
                  {fact.value}
                </option>
              ))}
            </select>
          </div>
          <Input
            type="url"
            aria-label="Correction target URL"
            placeholder="https://…"
            value={targetUrl}
            onChange={(event) => setTargetUrl(event.target.value)}
            required
          />
          <Button size="sm" type="submit" disabled={draft.isPending || !factId}>
            Create correction opportunity
          </Button>
        </form>
      )}
      {(draft.error || query.error) && (
        <p role="alert">
          {getStandardErrorMessage(draft.error || query.error)}
        </p>
      )}
      {query.data?.map((row) => (
        <CorrectionRow
          key={row.id}
          row={row}
          projectId={projectId}
          reviewer={reviewer}
          refresh={refresh}
        />
      ))}
    </div>
  );
}

function CorrectionRow({
  projectId,
  row,
  reviewer,
  refresh,
}: {
  projectId: string;
  row: Correction;
  reviewer: boolean;
  refresh: () => void;
}) {
  const [passage, setPassage] = useState("");
  const [candidate, setCandidate] = useState("");
  const data = { projectId, id: row.id };
  const navigate = useNavigate();
  const report = useMutation({
    mutationFn: () => saveClaimClientReport({ data }),
    onSuccess: ({ reportId }) =>
      navigate({
        to: "/p/$projectId/reports/$reportId",
        params: { projectId, reportId },
      }),
  });
  const estimate = useMutation({
    mutationFn: () => recheckCorrection({ data }),
  });
  const start = useMutation({
    mutationFn: (approval: { maxCostUsd: number; maxCredits: number }) =>
      recheckCorrection({ data: { ...data, approval } }),
    onSuccess: () => {
      estimate.reset();
      refresh();
    },
  });
  const submit = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => {
      await work();
    },
    onSuccess: refresh,
  });
  const visibleLedger =
    row.entries.find(
      (entry) =>
        entry.status === "executed" &&
        entry.publicationStatus === "published" &&
        entry.targetUrl === row.targetUrl,
    )?.id ?? row.ledgerId;
  const stage = row.publishedAt
    ? "Published source recorded"
    : row.ledgerId
      ? "Approved for manual implementation"
      : "Drafted";
  return (
    <section className="space-y-2 rounded-lg border p-3">
      <strong>{stage}</strong>
      <p className="break-all text-muted-foreground">{row.targetUrl}</p>
      <div className="flex flex-wrap gap-3">
        <Link
          to="/p/$projectId/opportunities"
          params={{ projectId }}
          className="underline"
        >
          Opportunities
        </Link>
        {row.assetId && (
          <Link
            to="/p/$projectId/content"
            params={{ projectId }}
            search={{ draft: row.assetId }}
            className="underline"
          >
            Open Content Studio draft
          </Link>
        )}
        {visibleLedger && (
          <Link
            to="/p/$projectId/changes"
            params={{ projectId }}
            search={{ change: visibleLedger }}
            className="underline"
          >
            Open Change Ledger
          </Link>
        )}
      </div>
      {row.outreachDraft && (
        <details>
          <summary>Outreach draft</summary>
          <p className="whitespace-pre-wrap">{row.outreachDraft}</p>
        </details>
      )}
      {reviewer && !row.publishedAt && (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={submit.isPending}
            onClick={() => submit.mutate(() => reviewClaimCorrection({ data }))}
          >
            {row.ledgerId ? "Approve current revision" : "Approve correction"}
          </Button>
          {row.ledgerId && (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                submit.mutate(() =>
                  checkClaimPublication({ data: { ...data, passage } }),
                );
              }}
            >
              <Input
                aria-label="Exact published passage"
                placeholder="Exact published passage"
                value={passage}
                onChange={(event) => setPassage(event.target.value)}
                maxLength={240}
                minLength={5}
                required
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={submit.isPending}
              >
                Verify published source
              </Button>
            </form>
          )}
        </>
      )}
      {row.publishedAt && (
        <div className="space-y-2">
          <h5 className="font-medium">Follow-up answers</h5>
          {reviewer && (
            <Button
              size="sm"
              variant="outline"
              disabled={report.isPending}
              onClick={() => report.mutate()}
            >
              Create private correction report
            </Button>
          )}
          {report.error && (
            <p role="alert" className="text-destructive">
              {getStandardErrorMessage(report.error)}
            </p>
          )}
          <p className="text-muted-foreground">
            Matches the baseline prompt, engine, market, language and reported
            model where available. Changes are observational.
          </p>
          {reviewer && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={estimate.isPending || start.isPending}
                onClick={() => estimate.mutate()}
              >
                Estimate a recheck
              </Button>
              {estimate.data && (
                <Button
                  size="sm"
                  disabled={start.isPending}
                  onClick={() =>
                    start.mutate({
                      maxCostUsd: estimate.data.costUsd,
                      maxCredits: estimate.data.credits,
                    })
                  }
                >
                  Run one answer · {estimate.data.credits} credits · provider
                  estimate ${estimate.data.costUsd.toFixed(4)}
                </Button>
              )}
              {start.data?.runId && (
                <span>
                  Queued. Review the answer in AI Search, extract its claims,
                  then record the recheck here.
                </span>
              )}
            </div>
          )}
          {(estimate.error || start.error) && (
            <p role="alert" className="text-destructive">
              {getStandardErrorMessage(estimate.error || start.error)}
            </p>
          )}
          {row.candidates.length === 0 && (
            <p>
              No comparable saved answer after publication yet. Run the same
              prompt in AI Search, then extract its claims.
            </p>
          )}
          {reviewer && row.candidates.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="Comparable answer"
                value={candidate}
                onChange={(event) => setCandidate(event.target.value)}
                className="rounded-md border bg-background px-2"
              >
                <option value="">Choose a saved answer</option>
                {row.candidates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.collectedAt?.slice(0, 16)} ·{" "}
                    {item.model ?? "Model unavailable"}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={submit.isPending || !candidate}
                onClick={() =>
                  submit.mutate(() =>
                    saveClaimFollowup({
                      data: { ...data, observationId: candidate },
                    }),
                  )
                }
              >
                Record recheck
              </Button>
            </div>
          )}
          {row.history.map((item) => (
            <p key={item.id}>
              {item.createdAt.slice(0, 10)} ·{" "}
              {item.outcome.replaceAll("_", " ")}
            </p>
          ))}
        </div>
      )}
      {submit.error && (
        <p role="alert" className="text-destructive">
          {getStandardErrorMessage(submit.error)}
        </p>
      )}
    </section>
  );
}
