import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CardShell } from "@/client/components/CardShell";
import { QueryState } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Skeleton } from "@/client/components/ui/skeleton";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  addAiBrandFact,
  checkAiBrandFacts,
  getAiFactCheckReport,
  removeAiBrandFact,
} from "@/serverFunctions/ai-fact-checks";

const reportKey = (projectId: string) => ["ai-fact-checks", projectId] as const;

export function BrandFactsPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: reportKey(projectId) });
  const onError = (error: unknown) =>
    toast.error(getStandardErrorMessage(error));
  const [statement, setStatement] = useState("");
  const query = useQuery({
    queryKey: reportKey(projectId),
    queryFn: () => getAiFactCheckReport({ data: { projectId } }),
  });
  const add = useMutation({
    mutationFn: () => addAiBrandFact({ data: { projectId, statement } }),
    onSuccess: () => {
      setStatement("");
      void refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (factId: string) =>
      removeAiBrandFact({ data: { projectId, factId } }),
    onSuccess: () => void refresh(),
    onError,
  });
  const check = useMutation({
    mutationFn: (runId: string) =>
      checkAiBrandFacts({ data: { projectId, runId } }),
    onSuccess: (result) => {
      toast.success(
        `Read ${result.answersRead} answers${result.remaining ? `, ${result.remaining} left: check again to continue` : ""}`,
      );
      void refresh();
    },
    onError,
  });

  return (
    <div className="px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Brand facts</h1>
          <p className="text-sm text-muted-foreground">
            Statements you confirm are true about your brand. Saved AI answers
            that name you are read against them by a small model; a verdict is a
            reading, not a ruling, so open the answer before acting.
          </p>
        </header>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <CardShell title="Facts">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (statement.trim().length >= 8) add.mutate();
              }}
            >
              <Input
                value={statement}
                maxLength={300}
                placeholder="The company offers a free trial."
                onChange={(event) => setStatement(event.target.value)}
              />
              <Button type="submit" disabled={add.isPending}>
                Add
              </Button>
            </form>
          </CardShell>
          <QueryState
            query={query}
            loading={<Skeleton className="h-40 w-full" />}
            errorFallback="Failed to load facts"
          >
            {(data) => (
              <CardShell title="What the latest run says">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>
                      {data.runId
                        ? `${data.answersNamingBrand} answers in the latest run name your brand.`
                        : "No finished run yet."}
                    </span>
                    {data.runId && data.facts.length ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={check.isPending}
                        onClick={() => check.mutate(data.runId!)}
                      >
                        {check.isPending ? "Checking…" : "Check latest run"}
                      </Button>
                    ) : null}
                  </div>
                  {data.facts.map((fact) => (
                    <div
                      key={fact.id}
                      className="rounded-md border p-3 text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">{fact.statement}</p>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(fact.id)}
                        >
                          Remove
                        </Button>
                      </div>
                      <p className="text-muted-foreground">
                        {fact.supported} support, {fact.contradicted}{" "}
                        contradict, {fact.notAddressed} do not address,{" "}
                        {fact.unchecked} not checked yet.
                      </p>
                      {fact.contradictions.map((c) => (
                        <p
                          key={c.observationId}
                          className="mt-2 text-destructive"
                        >
                          {c.engine}: {c.prompt}
                          {c.quote ? ` — “${c.quote}”` : ""}
                        </p>
                      ))}
                    </div>
                  ))}
                  {data.notes.map((note) => (
                    <p key={note} className="text-xs text-muted-foreground">
                      {note}
                    </p>
                  ))}
                </div>
              </CardShell>
            )}
          </QueryState>
        </div>
      </div>
    </div>
  );
}
