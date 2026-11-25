import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Globe } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Spinner } from "@/client/components/ui/spinner";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import { formatRelativeTime } from "@/client/lib/relative-time";
import { planDomainMarkets } from "@/serverFunctions/domain";

const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;

/** When the shown analysis was read, with a way to run it again once it is old. */
export function LastRunBar({
  fetchedAt,
  pending,
  onRun,
}: {
  fetchedAt: string;
  pending: boolean;
  onRun: () => void;
}) {
  const old = Date.now() - Date.parse(fetchedAt) > REFRESH_AFTER_MS;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span>Last analysis {formatRelativeTime(fetchedAt)}</span>
      {old ? (
        <Button size="xs" variant="outline" disabled={pending} onClick={onRun}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Run again
        </Button>
      ) : (
        <span>Can be run again after 12 hours</span>
      )}
    </div>
  );
}

/**
 * A domain that has not been analyzed yet. Opening it never starts a
 * provider read: the person starts it here, and only a workspace that pays the
 * provider is shown what it would cost.
 */
export function DomainReadyState({
  projectId,
  domain,
  isOwn,
  locationCode,
  pending,
  onAnalyse,
}: {
  projectId: string;
  domain: string;
  isOwn: boolean;
  locationCode: number;
  pending: boolean;
  onAnalyse: () => void;
}) {
  const { showCosts, cost } = useCostDisplay();
  // Cache only, so it costs nothing to ask.
  const plan = useQuery({
    enabled: showCosts,
    queryKey: ["domain-analysis-plan", projectId, domain, locationCode],
    queryFn: () =>
      planDomainMarkets({
        data: { projectId, domain, locationCodes: [locationCode] },
      }),
    staleTime: 5 * 60_000,
  });
  const estimate = cost(plan.data?.totalUsd);

  return (
    <Card className="items-start gap-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Globe className="size-4 text-muted-foreground" />
        <h2 className="text-base font-semibold break-all">{domain}</h2>
        {isOwn ? <Badge variant="secondary">Your site</Badge> : null}
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">
        No analysis of {isOwn ? "your site" : "this domain"} yet. Analyze it to
        read estimated organic traffic, ranking keywords and top pages. The
        result stays on screen, and reopening it is free.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onAnalyse} disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Analyze {domain}
        </Button>
        {estimate ? (
          <span className="text-xs text-muted-foreground">
            Estimated provider cost {estimate}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

/** The project has no usable website, so there is no domain to open on. */
export function NoSiteState({
  projectId,
  invalid,
}: {
  projectId: string;
  invalid: boolean;
}) {
  return (
    <Card className="items-start gap-3 p-5">
      <h2 className="text-base font-semibold">
        {invalid
          ? "This project's website could not be read"
          : "This project has no website yet"}
      </h2>
      <p className="max-w-prose text-sm text-muted-foreground">
        Set the website in project settings and Site Explorer will open on it.
        You can still research any domain below.
      </p>
      <Button
        variant="outline"
        nativeButton={false}
        render={<Link to="/p/$projectId/settings" params={{ projectId }} />}
      >
        Open project settings
      </Button>
    </Card>
  );
}
