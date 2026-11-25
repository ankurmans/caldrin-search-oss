import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { HelpLabel } from "@/client/components/HelpLabel";
import { LocationSelect } from "@/client/components/LocationSelect";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import {
  DATAFORSEO_ESTIMATE,
  SourceNote,
} from "@/client/features/domain/components/overview/SourceNote";
import { formatNumber } from "@/client/features/domain/utils";
import { LABS_LOCATION_OPTIONS } from "@/client/features/keywords/locations";
import { plainReason } from "@/client/features/spend/costText";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { planDomainMarkets, readDomainMarkets } from "@/serverFunctions/domain";

const MAX_MARKETS = 5;

function labelOf(locationCode: number) {
  return (
    LABS_LOCATION_OPTIONS.find((option) => option.code === locationCode)
      ?.label ?? String(locationCode)
  );
}

/**
 * The searched market is read with the page. Other markets are read only here,
 * after the person has picked them and seen what they cost: the preview reads
 * the cache alone, and the read starts from its own button.
 */
export function MarketsCard({
  projectId,
  domain,
  searchedLocationCode,
  projectLocationCode,
  current,
}: {
  projectId: string;
  domain: string;
  searchedLocationCode: number;
  projectLocationCode: number;
  current: {
    organicKeywords: number | null;
    organicTraffic: number | null;
  } | null;
}) {
  const { showCosts, cost } = useCostDisplay();
  const price = (value: number) => (value === 0 ? "free" : cost(value));
  const [picked, setPicked] = useState<number[]>([]);
  const input = { projectId, domain, locationCodes: picked };

  const plan = useMutation({
    mutationFn: () => planDomainMarkets({ data: input }),
  });
  const read = useMutation({
    mutationFn: () => readDomainMarkets({ data: input }),
  });

  const change = (next: number[]) => {
    setPicked(next);
    plan.reset();
    read.reset();
  };
  const add = (code: number) => {
    if (
      code !== searchedLocationCode &&
      !picked.includes(code) &&
      picked.length < MAX_MARKETS
    ) {
      change([...picked, code]);
    }
  };
  const options = LABS_LOCATION_OPTIONS.filter(
    (option) => option.code !== searchedLocationCode,
  );

  return (
    <Card className="gap-3 p-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">
          <HelpLabel
            label="Markets"
            helpText={
              showCosts
                ? "Organic keywords and traffic in other countries. Each market is a separate provider read, so none runs until you confirm its cost."
                : "Organic keywords and traffic in other countries. Each market is a separate paid lookup, so none runs until you confirm it."
            }
          />
        </h2>
        <p className="text-xs text-muted-foreground">
          Showing {labelOf(searchedLocationCode)}. Pick up to {MAX_MARKETS} more
          to compare.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <LocationSelect
          value={0}
          options={options}
          className="w-52"
          onChange={add}
        />
        {projectLocationCode !== searchedLocationCode &&
        !picked.includes(projectLocationCode) ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => add(projectLocationCode)}
          >
            Add {labelOf(projectLocationCode)} (project market)
          </Button>
        ) : null}
      </div>

      {picked.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {picked.map((code) => (
            <li
              key={code}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm"
            >
              {labelOf(code)}
              <button
                type="button"
                aria-label={`Remove ${labelOf(code)}`}
                onClick={() => change(picked.filter((c) => c !== code))}
              >
                <XIcon className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {picked.length > 0 && !read.data ? (
        <div className="space-y-2">
          {plan.data ? (
            <>
              <table className="w-full text-sm">
                <tbody>
                  {plan.data.markets.map((market) => (
                    <tr
                      key={market.locationCode}
                      className="border-t border-border"
                    >
                      <td className="py-1.5">{labelOf(market.locationCode)}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {market.cached
                          ? "already read, free"
                          : (price(market.estimateUsd) ?? "paid lookup")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Button
                size="sm"
                disabled={read.isPending}
                onClick={() => read.mutate()}
              >
                {read.isPending
                  ? "Reading..."
                  : `Read ${picked.length} ${picked.length === 1 ? "market" : "markets"}${price(plan.data.totalUsd) ? `, up to ${price(plan.data.totalUsd)}` : ""}`}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={plan.isPending}
              onClick={() => plan.mutate()}
            >
              {plan.isPending
                ? "Checking..."
                : showCosts
                  ? "Preview cost"
                  : "Review markets"}
            </Button>
          )}
          {plan.isError || read.isError ? (
            <p className="text-sm text-destructive">
              {plainReason(
                getStandardErrorMessage(
                  plan.error ?? read.error,
                  "That did not work",
                ),
                showCosts,
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      {read.data ? (
        <>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 text-left font-normal">Market</th>
                <th className="py-1 text-right font-normal">
                  Organic keywords
                </th>
                <th className="py-1 text-right font-normal">Est. traffic</th>
              </tr>
            </thead>
            <tbody>
              {current ? (
                <tr className="border-t border-border">
                  <td className="py-1.5">
                    {labelOf(searchedLocationCode)} (shown above)
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatNumber(current.organicKeywords)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatNumber(current.organicTraffic)}
                  </td>
                </tr>
              ) : null}
              {read.data.rows.map((row) => (
                <tr key={row.locationCode} className="border-t border-border">
                  <td className="py-1.5">{labelOf(row.locationCode)}</td>
                  {row.status === "error" ? (
                    <td
                      colSpan={2}
                      className="py-1.5 text-right text-muted-foreground"
                    >
                      Could not be read
                    </td>
                  ) : !row.hasData ? (
                    <td
                      colSpan={2}
                      className="py-1.5 text-right text-muted-foreground"
                    >
                      No ranking data
                    </td>
                  ) : (
                    <>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatNumber(row.organicKeywords)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatNumber(row.organicTraffic)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <SourceNote source={DATAFORSEO_ESTIMATE} date={null} />
        </>
      ) : null}
    </Card>
  );
}
