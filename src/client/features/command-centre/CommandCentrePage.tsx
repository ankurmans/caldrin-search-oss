import { DashboardGoogleSetup } from "@/client/features/dashboard/DashboardGoogleSetup";
import { DashboardOnboardingGoal } from "@/client/features/dashboard/DashboardOnboardingGoal";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Search, Settings } from "lucide-react";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/client/components/CommandPalette";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { AiReferralsCard } from "@/client/features/ai-visibility/AiReferralsCard";
import { WorkspaceMergeBanner } from "@/client/features/dashboard/WorkspaceMergeBanner";
import { DashboardFirstRead } from "@/client/features/dashboard/DashboardFirstRead";
import { DashboardNewQueries } from "@/client/features/dashboard/DashboardNewQueries";
import { GscCard } from "@/client/features/dashboard/DashboardCards";
import { useProjectMarket } from "@/client/features/projects/useProjectMarket";
import { LOCATIONS } from "@/shared/keyword-locations";
import { getCommandCentre } from "@/serverFunctions/command-centre";
import { getDashboardActivation } from "@/serverFunctions/dashboard";
import {
  commandCentreKey,
  type CommandCentreData,
} from "@/client/features/command-centre/helpers";
import { DataStatus } from "./DataStatus";
import { buildDataStatus } from "./dataSources";
import { NextActions, NoNextActions } from "./NextActions";
import { AiPulse } from "./AiPulse";
import { CompetitivePulse, OrganicPulse } from "./Pulses";
import { SetupStrip } from "./SetupStrip";
import { WorkInProgress } from "./WorkInProgress";

export function CommandCentrePage({
  projectId,
  googleExpanded,
}: {
  projectId: string;
  googleExpanded: boolean;
}) {
  const queryClient = useQueryClient();
  const market = useProjectMarket(projectId);
  const activationQuery = useQuery({
    queryKey: ["dashboardActivation", projectId],
    queryFn: () => getDashboardActivation({ data: { projectId } }),
    // Setup steps complete from research pages and agents.
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  const centreQuery = useQuery({
    queryKey: commandCentreKey(projectId),
    queryFn: () => getCommandCentre({ data: { projectId } }),
    refetchOnMount: "always",
  });
  const activation = activationQuery.data;
  const data = centreQuery.data;

  if (activationQuery.isError && !activation) {
    return (
      <div className="px-4 py-4 md:px-6 md:py-6">
        <QueryError
          error={activationQuery.error}
          fallback="Failed to load the dashboard"
          onRetry={() => void activationQuery.refetch()}
          isRetrying={activationQuery.isFetching}
        />
      </div>
    );
  }
  if (!activation || !data) {
    return centreQuery.isError ? (
      <div className="px-4 py-4 md:px-6 md:py-6">
        <QueryError
          error={centreQuery.error}
          fallback="Failed to load the dashboard"
          onRetry={() => void centreQuery.refetch()}
          isRetrying={centreQuery.isFetching}
        />
      </div>
    ) : (
      <CommandCentreSkeleton />
    );
  }

  const gscConnected = activation.gsc.connected;
  const goal = activation.onboarding.goal;
  const canChooseGoal =
    activation.onboarding.firstReadViewed ||
    activation.dismissedSteps.includes("first_read");
  const googlePending = !gscConnected || !activation.ga4.connected;
  const showGoogle =
    Boolean(activation.domain) &&
    googlePending &&
    !activation.dismissedSteps.includes("google");
  const market_ = market ? LOCATIONS[market.locationCode] : undefined;

  const organic = (
    <OrganicPulse
      key="organic"
      projectId={projectId}
      gscConnected={gscConnected}
      siteUrl={activation.gsc.siteUrl}
      rank={data.rank}
    />
  );
  const ai = <AiPulse key="ai" projectId={projectId} ai={data.ai} />;
  const showOpportunities =
    Boolean(data.opportunities?.lastObservedAt) || data.competitors === 0;
  const opportunities = showOpportunities ? (
    <CompetitivePulse key="opportunities" projectId={projectId} data={data} />
  ) : null;
  const summary = (
    <div
      key="summary"
      className={`grid divide-y divide-border overflow-hidden rounded-xl border border-border bg-card ${showOpportunities ? "@4xl:grid-cols-3 @4xl:divide-x @4xl:divide-y-0" : "@2xl:grid-cols-2 @2xl:divide-x @2xl:divide-y-0"}`}
    >
      {goal === "links"
        ? [opportunities, organic, ai]
        : [organic, ai, opportunities]}
    </div>
  );

  const nextSteps = (
    <CommandCentreNextSteps
      key="next-steps"
      projectId={projectId}
      data={data}
      sourceConnected={gscConnected || data.store !== null}
      workFirst={goal === "agent"}
    />
  );
  const nextStepsFirst =
    goal === "content" ||
    goal === "agent" ||
    (goal === "links" && !showOpportunities);

  return (
    <div className="px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="@container mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Project Overview
              </p>
              <h1 className="text-2xl font-semibold break-words">
                {activation.domain ?? "Your project"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {market_ ? `${market_} market · ` : ""}
                {market ? `${market.languageCode.toUpperCase()} · ` : ""}
                Last 28 days
              </p>
            </div>
            <DataStatus
              projectId={projectId}
              status={buildDataStatus({ gscConnected, data })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canChooseGoal && goal && (
              <DashboardOnboardingGoal
                key={projectId}
                projectId={projectId}
                goal={goal}
              />
            )}
            <Button
              variant="outline"
              onClick={() =>
                window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))
              }
            >
              <Search /> Search or jump
            </Button>
            <Button
              variant="outline"
              disabled={centreQuery.isFetching}
              onClick={() =>
                void queryClient.invalidateQueries({
                  queryKey: commandCentreKey(projectId),
                })
              }
              aria-label="Reload stored data"
            >
              <RefreshCw
                className={centreQuery.isFetching ? "animate-spin" : ""}
              />
              Reload
            </Button>
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link to="/p/$projectId/settings" params={{ projectId }} />
              }
            >
              <Settings /> Settings
            </Button>
          </div>
        </header>

        <WorkspaceMergeBanner />

        {!activation.domain && (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-5">
            <h2 className="text-lg font-semibold">Add your website</h2>
            <Button
              nativeButton={false}
              render={
                <Link to="/p/$projectId/settings" params={{ projectId }} />
              }
            >
              Set website and market
            </Button>
          </section>
        )}

        <SetupStrip projectId={projectId} activation={activation} />

        {showGoogle && (
          <DashboardGoogleSetup
            projectId={projectId}
            expanded={googleExpanded}
          />
        )}
        {activation.domain && (
          <DashboardFirstRead
            projectId={projectId}
            domain={activation.domain}
            siteUrl={activation.gsc.siteUrl}
          />
        )}

        {canChooseGoal && !goal && (
          <DashboardOnboardingGoal
            key={projectId}
            projectId={projectId}
            goal={goal}
          />
        )}
        {nextStepsFirst ? [nextSteps, summary] : [summary, nextSteps]}

        <section
          aria-labelledby="search-performance-heading"
          className="space-y-3"
        >
          <h2
            id="search-performance-heading"
            className="text-base font-semibold"
          >
            Search Performance
          </h2>
          <div
            className={
              gscConnected
                ? "grid gap-4 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
                : "grid gap-4"
            }
          >
            <GscCard
              projectId={projectId}
              connected={gscConnected}
              siteUrl={activation.gsc.siteUrl}
            />
            <DashboardNewQueries
              projectId={projectId}
              connected={gscConnected}
              siteUrl={activation.gsc.siteUrl}
            />
          </div>
          <AiReferralsCard projectId={projectId} />
          {data.audit ? (
            <p className="text-sm text-muted-foreground">
              Site audit:{" "}
              {data.audit.status === "running"
                ? "crawl running"
                : `${data.audit.pagesCrawled} pages crawled${
                    data.audit.topIssues.length > 0
                      ? `, ${data.audit.topIssues.reduce((n, i) => n + i.count, 0)} flagged`
                      : ", no issues"
                  }`}
              .{" "}
              <Link
                to="/p/$projectId/audit"
                params={{ projectId }}
                className="underline underline-offset-2"
              >
                Open Site Audit
              </Link>
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function CommandCentreNextSteps({
  projectId,
  data,
  sourceConnected,
  workFirst,
}: {
  projectId: string;
  data: CommandCentreData;
  sourceConnected: boolean;
  workFirst: boolean;
}) {
  const actions =
    data.opportunities === null ? (
      <section key="actions" className="p-4">
        <h2 className="text-base font-semibold">Recommended Actions</h2>
        <p className="text-sm text-muted-foreground">
          Unavailable right now. Reload to try again.
        </p>
      </section>
    ) : data.opportunities.next.length === 0 ? (
      <NoNextActions
        key="actions"
        projectId={projectId}
        total={data.opportunities.total}
        sourceConnected={sourceConnected}
      />
    ) : (
      <NextActions
        key="actions"
        projectId={projectId}
        actions={data.opportunities.next}
        demoCount={data.opportunities.demo}
        open={data.opportunities.open}
        lastObservedAt={data.opportunities.lastObservedAt}
      />
    );
  const work = <WorkInProgress key="work" projectId={projectId} data={data} />;
  const hasRecommendedActions = (data.opportunities?.next.length ?? 0) > 0;
  const nextStepsColumns = !hasRecommendedActions
    ? "@2xl:grid-cols-2"
    : workFirst
      ? "@2xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
      : "@2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]";
  return (
    <div
      className={`grid divide-y divide-border overflow-hidden rounded-xl border border-border bg-card @2xl:divide-x @2xl:divide-y-0 ${nextStepsColumns}`}
    >
      {workFirst ? [work, actions] : [actions, work]}
    </div>
  );
}

function CommandCentreSkeleton() {
  return (
    <div className="px-4 py-4 md:px-6 md:py-6" aria-busy>
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <Skeleton className="h-16 w-72" />
        <div className="grid items-start gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <div className="grid gap-4 xl:grid-cols-2">
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
            </div>
            <Skeleton className="h-36" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-28" />
          </div>
        </div>
      </div>
    </div>
  );
}
