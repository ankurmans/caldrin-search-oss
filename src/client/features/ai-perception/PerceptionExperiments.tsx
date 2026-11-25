import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  AiLoading,
  AiQueryError,
} from "@/client/features/ai-visibility/shared";
import { ExperimentEditor } from "./ExperimentEditor";
import { perceptionExperimentsQueryOptions } from "./perceptionShared";

export function PerceptionExperiments({ projectId }: { projectId: string }) {
  // An experiment id, "new", or nothing selected.
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery(perceptionExperimentsQueryOptions(projectId));
  if (query.isPending) return <AiLoading />;
  if (query.isError)
    return (
      <AiQueryError error={query.error} retry={() => void query.refetch()} />
    );
  const { experiments, prompts } = query.data;
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-medium">Content experiments</h2>
          <Badge variant="outline">Experimental · simulated</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Try a page edit before publishing it. A model is handed the page as it
          stands, then the edit, and asked your saved prompts several times. The
          repeats show how much the answer moves on its own. This is not what an
          answer engine would say, and nothing is published from here.
        </p>
      </div>
      {selected ? (
        <ExperimentEditor
          projectId={projectId}
          experimentId={selected === "new" ? null : selected}
          prompts={prompts}
          onSelect={(id) => setSelected(id)}
        />
      ) : (
        <div className="space-y-3">
          <Button onClick={() => setSelected("new")}>New experiment</Button>
          {experiments.length ? (
            <ul className="space-y-2">
              {experiments.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(e.id)}
                    className="flex w-full flex-wrap items-center gap-2 rounded-xl border bg-card p-3 text-left text-sm hover:bg-muted/40"
                  >
                    <span className="font-medium">{e.title}</span>
                    <Badge variant="secondary">{e.status}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {e.prompts} prompts · {e.repeats} repeats
                      {e.replayedAt ? ` · $${e.costUsd.toFixed(3)}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No experiments yet.</p>
          )}
        </div>
      )}
    </section>
  );
}
