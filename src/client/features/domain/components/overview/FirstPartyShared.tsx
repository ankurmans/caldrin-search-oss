import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { QueryError } from "@/client/components/QueryState";
import { Card } from "@/client/components/ui/card";
import { Skeleton } from "@/client/components/ui/skeleton";
import { getErrorCode } from "@/client/lib/error-messages";

export type Input = { projectId: string; domain: string };

const retry = (failureCount: number, error: unknown) =>
  failureCount < 1 && getErrorCode(error) !== "TRIAL_ENDED";

// First-party reads are free and cheap, but Google reports lag by a day, so
// ten minutes keeps tab switches instant without hiding a fresh sync.
export function useFirstParty<T>(
  source: string,
  { projectId, domain }: Input,
  read: (data: Input) => Promise<T>,
) {
  return useQuery({
    queryKey: ["domain-first-party", source, projectId, domain],
    queryFn: () => read({ projectId, domain }),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry,
  });
}

export function Frame({
  title,
  note,
  children,
}: {
  title: string;
  note: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="gap-3 p-4">
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {note}
      </div>
      {children}
    </Card>
  );
}

export function Message({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

export type Change = { text: string; tone: "good" | "bad" | "flat" };

const CHANGE_CLASS: Record<Change["tone"], string> = {
  good: "font-medium text-green-700 dark:text-success",
  bad: "font-medium text-red-700 dark:text-destructive",
  flat: "text-muted-foreground",
};

export function Stat({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change?: Change | null;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {change ? (
        <div className={`text-xs tabular-nums ${CHANGE_CLASS[change.tone]}`}>
          {change.text}
        </div>
      ) : null}
    </div>
  );
}

// An arrow beside the colour, so the direction doesn't rest on colour alone.
// A move too small to mean anything stays grey and unmarked.
function toChange(better: number, flat: boolean, text: string): Change {
  if (flat) return { text, tone: "flat" };
  return {
    text: `${better > 0 ? "▲" : "▼"} ${text}`,
    tone: better > 0 ? "good" : "bad",
  };
}

const signed = (value: number, digits: number) =>
  `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;

export function percentChange(
  current: number | null,
  previous: number | null,
): Change | null {
  if (current == null || previous == null || previous === 0) return null;
  const change = ((current - previous) / previous) * 100;
  return toChange(
    change,
    Math.abs(change) < 1,
    `${signed(change, 1)}% vs previous period`,
  );
}

/** A rate that moved by this many percentage points. */
export function pointsChange(points: number | null, digits = 1): Change | null {
  if (points == null) return null;
  return toChange(
    points,
    Math.abs(points) < 1,
    `${signed(points, digits)} pts vs previous period`,
  );
}

/** Rankings improve as the position number falls. */
export function positionChange(
  current: number,
  previous: number,
): Change | null {
  if (!previous) return null;
  const better = previous - current;
  return toChange(
    better,
    Math.abs(better) < 0.1,
    `${Math.abs(better).toFixed(1)} ${better >= 0 ? "better" : "worse"} vs previous period`,
  );
}

export function percent(value: number | null | undefined, digits = 1) {
  return value == null ? "-" : `${(value * 100).toFixed(digits)}%`;
}

/** Loading, error and not-connected states shared by every first-party card. */
export function SourceCard<T extends { status: string }>({
  query,
  title,
  projectId,
  connectLabel,
  children,
}: {
  query: ReturnType<typeof useFirstParty<T>>;
  title: string;
  projectId: string;
  connectLabel: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isLoading) {
    return (
      <Card className="gap-3 p-4" aria-busy>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }
  if (query.isError) {
    return (
      <QueryError
        variant="card"
        error={query.error}
        fallback={`${title} failed to load.`}
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }
  const data = query.data;
  if (!data || data.status === "not_own_domain") return null;
  if (data.status === "not_connected") {
    return (
      <Frame title={title} note={null}>
        <Message>
          {connectLabel} is not connected.{" "}
          <Link
            to="/p/$projectId/settings/integrations"
            params={{ projectId }}
            className="text-foreground underline"
          >
            Connect it
          </Link>{" "}
          to see the real figures beside the estimates.
        </Message>
      </Frame>
    );
  }
  return children(data);
}
