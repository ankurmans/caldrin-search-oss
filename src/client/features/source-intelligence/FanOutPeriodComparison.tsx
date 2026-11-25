import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { getFanOutComparison } from "@/serverFunctions/source-intelligence";
import type { SourceFilters } from "@/types/schemas/source-intelligence";

function dateRange(start: string, end: string) {
  const inclusiveEnd = new Date(Date.parse(end) - 86_400_000).toISOString();
  return `${start.slice(0, 10)} to ${inclusiveEnd.slice(0, 10)}`;
}

export function FanOutPeriodComparison({
  projectId,
  filters,
}: {
  projectId: string;
  filters: SourceFilters;
}) {
  const [open, setOpen] = useState(false);
  const comparison = useQuery({
    queryKey: ["fan-out-comparison", projectId, filters],
    queryFn: () => getFanOutComparison({ data: { projectId, filters } }),
    enabled: open,
  });
  const result = comparison.data;

  return (
    <section className="rounded-lg border bg-card p-3">
      <Button
        size="sm"
        variant="outline"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Compare periods
      </Button>
      {open && (
        <div className="mt-3 space-y-3 text-sm">
          {comparison.isPending && (
            <p role="status">Comparing saved searches…</p>
          )}
          {comparison.isError && (
            <p role="alert">
              Could not compare periods.{" "}
              <button
                className="underline"
                onClick={() => void comparison.refetch()}
              >
                Try again
              </button>
            </p>
          )}
          {result && !result.comparable && <p>{result.reason}</p>}
          {result?.comparable && (
            <>
              <div className="space-y-1 text-muted-foreground">
                <p>
                  {dateRange(result.dates.start, result.dates.split)} (
                  {result.beforeAnswers} of {result.beforeTotal} lists reported)
                  {" · "}
                  {dateRange(result.dates.split, result.dates.end)} (
                  {result.afterAnswers} of {result.afterTotal} lists reported)
                </p>
                <p>
                  Share of answers with a reported search list, weighted equally
                  across {result.prompts}{" "}
                  {result.prompts === 1 ? "prompt" : "prompts"}.
                </p>
              </div>
              <FanOutMovers changes={result.changes} />
            </>
          )}
        </div>
      )}
    </section>
  );
}

function FanOutMovers({
  changes,
}: {
  changes: {
    query: string;
    beforePct: number;
    afterPct: number;
    beforeAnswers: number;
    afterAnswers: number;
    change: number;
  }[];
}) {
  if (!changes.length) return <p>No change at the displayed precision.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">
          Largest changes in reported search share
        </caption>
        <thead>
          <tr className="text-muted-foreground">
            <th scope="col" className="p-2 font-medium">
              Reported search
            </th>
            <th scope="col" className="p-2 text-right font-medium">
              Prior
            </th>
            <th scope="col" className="p-2 text-right font-medium">
              Recent
            </th>
            <th scope="col" className="p-2 text-right font-medium">
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          {changes.map((row) => (
            <tr key={row.query} className="border-t">
              <th scope="row" className="p-2 font-medium">
                {row.query}
              </th>
              <td
                className="p-2 text-right tabular-nums"
                title={`${row.beforeAnswers} answers`}
              >
                {row.beforePct}%
              </td>
              <td
                className="p-2 text-right tabular-nums"
                title={`${row.afterAnswers} answers`}
              >
                {row.afterPct}%
              </td>
              <td className="p-2 text-right whitespace-nowrap tabular-nums">
                {row.change > 0 ? "+" : ""}
                {row.change} pp
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
