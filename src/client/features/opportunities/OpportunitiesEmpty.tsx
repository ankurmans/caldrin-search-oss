import { Link } from "@tanstack/react-router";
import { Button } from "@/client/components/ui/button";
import { EmptyState } from "@/client/components/EmptyState";

type Readiness = {
  gscConnected: boolean;
  /** The store connection's mode, or null when no store is connected. */
  storeMode: string | null;
  /** The project is a Shopify store, so connecting one is worth suggesting. */
  storeRelevant: boolean;
};

/**
 * Three different reasons the list can be empty, each with its own next step:
 * no data source is connected, a source is connected but no result is stored
 * yet, or an analysis ran in this session and found nothing to recommend.
 */
export function NoOpportunities({
  projectId,
  readiness,
  ranNothing,
  onRun,
  running,
}: {
  projectId: string;
  /** Undefined while the connection checks are still loading. */
  readiness: Readiness | undefined;
  /** An analysis finished in this session and stored no opportunities. */
  ranNothing: boolean;
  onRun: () => void;
  running: boolean;
}) {
  const runButton = (
    <Button size="sm" disabled={running} onClick={onRun}>
      {running ? "Analyzing…" : "Run analysis"}
    </Button>
  );
  const sources = readiness
    ? [
        readiness.gscConnected ? "Search Console" : null,
        readiness.storeMode === "simulated"
          ? "the demo store"
          : readiness.storeMode
            ? "your Shopify store"
            : null,
      ].filter((name): name is string => name !== null)
    : [];

  if (ranNothing) {
    return (
      <EmptyState
        title="The analysis found nothing to recommend"
        description="It ran and stored no opportunities. The message above lists anything it could not check; a source with no data in the last 28 days is the usual reason."
        action={runButton}
      />
    );
  }
  if (readiness && sources.length === 0) {
    return (
      <EmptyState
        title="Connect a data source to find opportunities"
        description={`Opportunities are ranked from your own search data. Connect Search Console${readiness.storeRelevant ? ", or a store" : ""}, then run the analysis.`}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              size="sm"
              nativeButton={false}
              render={
                <Link
                  to="/p/$projectId/settings/integrations"
                  params={{ projectId }}
                  hash="search-console"
                />
              }
            >
              Connect Search Console
            </Button>
            {readiness.storeRelevant ? (
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={
                  <Link
                    to="/p/$projectId/settings/integrations"
                    params={{ projectId }}
                    hash="store"
                  />
                }
              >
                Connect a store
              </Button>
            ) : null}
          </div>
        }
      />
    );
  }
  return (
    <EmptyState
      title="No analysis result yet"
      description={
        sources.length > 0
          ? `${sources.join(" and ")} ${sources.length > 1 ? "are" : "is"} connected. Run the analysis to read ${sources.length > 1 ? "them" : "it"}, rank what it finds and show the numbers behind each recommendation. Anything it cannot read is reported, not guessed.`
          : "Run the analysis to rank what it finds and show the numbers behind each recommendation. Anything it cannot read is reported, not guessed."
      }
      action={runButton}
    />
  );
}

export function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <EmptyState
      kind="filtered"
      title="No opportunities match these filters"
      action={
        <Button size="sm" variant="outline" onClick={onClear}>
          Clear filters
        </Button>
      }
    />
  );
}
