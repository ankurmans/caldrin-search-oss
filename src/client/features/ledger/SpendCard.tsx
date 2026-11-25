import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { QueryState } from "@/client/components/QueryState";
import { SkeletonCard } from "@/client/components/SkeletonPresets";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import type { ProviderSpend, SpendLimits } from "@/server/features/spend/types";
import type { UsageDisplay } from "@/server/features/spend/services/UsageDisplayService";
import { getSpendOverview, setSpendLimits } from "@/serverFunctions/spend";
import { usageDisplayKey } from "@/client/features/spend/useCostDisplay";
import { formatUsd, spendKey, unwrap } from "./helpers";

export function SpendCard({ projectId }: { projectId: string }) {
  const query = useQuery({
    queryKey: spendKey(projectId),
    queryFn: () => getSpendOverview({ data: { projectId } }),
  });
  return (
    <section
      aria-labelledby="spend-heading"
      className="space-y-4 rounded-xl border bg-card p-4"
    >
      <QueryState
        query={query}
        errorFallback="Could not load usage."
        loading={<SkeletonCard />}
      >
        {({ display, limits, spend, moneyLimitActive }) => (
          <>
            <div className="space-y-1">
              <h2 id="spend-heading" className="text-sm font-medium">
                Usage &amp; Limits
              </h2>
              <p className="text-xs text-muted-foreground">
                {display.showProviderCosts
                  ? "Provider cost recorded for this project. A limit stops scheduled checks, drafting and gap research that would pass it. Keyword, domain, backlink, rank and AI visibility lookups started by you or an agent are not counted yet. Leave a field empty for no limit."
                  : display.mode === "trial"
                    ? "Your free test run covers paid lookups until it is used up."
                    : "Paid lookups are included in your plan."}
              </p>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              {spend ? (
                <SpendTotals
                  todayUsd={spend.todayUsd}
                  monthUsd={spend.monthUsd}
                  byProvider={spend.byProvider}
                  limits={limits}
                />
              ) : (
                <PlanUsage
                  display={display}
                  moneyLimitActive={moneyLimitActive}
                />
              )}
              <LimitsForm
                key={JSON.stringify(limits)}
                projectId={projectId}
                limits={limits}
                showMoney={display.showProviderCosts}
              />
            </div>
          </>
        )}
      </QueryState>
    </section>
  );
}

// Cloud and free-test workspaces are not shown provider charges: only what the
// plan or the free run allows.
function PlanUsage({
  display,
  moneyLimitActive,
}: {
  display: UsageDisplay;
  moneyLimitActive: boolean;
}) {
  return (
    <div className="space-y-3 text-sm">
      {display.allowance ? (
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Free test run</p>
          <p className="text-lg font-semibold tabular-nums">
            ${display.allowance.remainingUsd.toFixed(2)} of $
            {display.allowance.budgetUsd.toFixed(2)} left
          </p>
          <p className="text-xs text-muted-foreground">
            Add your own keys any time to keep going after it is used.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Plan</p>
          <p className="text-lg font-semibold">Usage included</p>
          <p className="text-xs text-muted-foreground">
            Paid lookups run on your plan. Each one asks you to confirm first.
          </p>
        </div>
      )}
      {moneyLimitActive ? (
        <p className="text-xs text-muted-foreground">
          A spending limit is set on this project. Paid work pauses when it is
          reached.
        </p>
      ) : null}
    </div>
  );
}

function SpendTotals({
  todayUsd,
  monthUsd,
  byProvider,
  limits,
}: {
  todayUsd: number;
  monthUsd: number;
  byProvider: ProviderSpend[];
  limits: SpendLimits;
}) {
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3">
        <Total
          label="Today"
          value={todayUsd}
          limit={limits.dailyUsd}
          limitLabel="daily limit"
        />
        <Total
          label="This month"
          value={monthUsd}
          limit={limits.monthlyUsd}
          limitLabel="monthly limit"
        />
      </dl>
      {byProvider.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No provider spend recorded yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead className="text-right">Today</TableHead>
              <TableHead className="text-right">This month</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byProvider.map((row) => (
              <TableRow key={row.provider}>
                <TableCell>{row.provider}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(row.todayUsd)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(row.monthUsd)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function Total({
  label,
  value,
  limit,
  limitLabel,
}: {
  label: string;
  value: number;
  limit: number | null;
  limitLabel: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{formatUsd(value)}</dd>
      <p className="text-xs text-muted-foreground">
        {limit === null ? `No ${limitLabel}` : `of ${formatUsd(limit)}`}
      </p>
    </div>
  );
}

function toText(value: number | null): string {
  return value === null ? "" : String(value);
}

// Empty clears the limit. NaN means the text was not a number.
function parseLimit(text: string): number | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : Number(trimmed);
}

function LimitsForm({
  projectId,
  limits,
  showMoney,
}: {
  projectId: string;
  limits: SpendLimits;
  showMoney: boolean;
}) {
  const queryClient = useQueryClient();
  const [daily, setDaily] = useState(toText(limits.dailyUsd));
  const [monthly, setMonthly] = useState(toText(limits.monthlyUsd));
  const [jobs, setJobs] = useState(toText(limits.scheduledJobsPerDay));
  const save = useMutation({
    mutationFn: (input: SpendLimits) =>
      setSpendLimits({ data: { projectId, ...input } }),
    onSuccess: (result) => {
      if (!unwrap(result)) return;
      toast.success("Limits saved.");
      void queryClient.invalidateQueries({ queryKey: spendKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: usageDisplayKey });
    },
  });
  const next = {
    dailyUsd: parseLimit(daily),
    monthlyUsd: parseLimit(monthly),
    scheduledJobsPerDay: parseLimit(jobs),
  };
  const invalid = Object.values(next).some(
    (value) => value !== null && (Number.isNaN(value) || value < 0),
  );
  const jobsInvalid =
    next.scheduledJobsPerDay !== null &&
    !Number.isInteger(next.scheduledJobsPerDay);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(next);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {showMoney ? (
          <>
            <LimitField
              label="Daily limit (USD)"
              value={daily}
              onChange={setDaily}
              step="0.01"
            />
            <LimitField
              label="Monthly limit (USD)"
              value={monthly}
              onChange={setMonthly}
              step="0.01"
            />
          </>
        ) : null}
        <LimitField
          label="Scheduled jobs per day"
          value={jobs}
          onChange={setJobs}
          step="1"
        />
      </div>
      {invalid || jobsInvalid ? (
        <p role="alert" className="text-xs text-destructive">
          Enter zero or a positive number. Scheduled jobs must be a whole
          number.
        </p>
      ) : null}
      <Button
        type="submit"
        size="sm"
        pending={save.isPending}
        disabled={invalid || jobsInvalid}
      >
        Save limits
      </Button>
    </form>
  );
}

function LimitField({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  step: string;
}) {
  const id = `limit-${label.replaceAll(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min="0"
        step={step}
        placeholder="No limit"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
