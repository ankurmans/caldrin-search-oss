import { firstBy } from "remeda";
import { Badge } from "@/client/components/ui/badge";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { channelLabel, formatCredited, moneyLines } from "./format";
import type { getAttributionLandingPagesFn } from "@/serverFunctions/attributionSearch";

type Landing = Awaited<ReturnType<typeof getAttributionLandingPagesFn>>;

const COMMERCIAL = ["lead", "qualified_lead", "call", "booking", "deal_won"];

/** The channel most of a page's sessions arrived through. */
function topChannel(channels: Record<string, number>) {
  const best = firstBy(Object.entries(channels), [(entry) => entry[1], "desc"]);
  return best ? channelLabel(best[0]) : "—";
}

/**
 * Pages sessions landed on, with what those sessions led to. The first four
 * figures come from first-party events; the search columns are what Search
 * Console says about the page and are marked as such.
 */
export function LandingPagesTable({
  landing,
  onOpen,
}: {
  landing: Landing;
  onOpen: (host: string, path: string) => void;
}) {
  const { pages, reportingCurrency, searchStatus } = landing;
  return (
    <div className="space-y-2">
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Page</TableHead>
              <TableHead className="text-right">Sessions</TableHead>
              <TableHead>Mostly from</TableHead>
              <TableHead className="text-right">Signups</TableHead>
              <TableHead className="text-right">Leads and deals</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">
                Search clicks <Badge variant="secondary">Associated</Badge>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pages.map((row) => (
              <TableRow key={`${row.host}${row.path}`}>
                <TableCell className="max-w-72">
                  <button
                    type="button"
                    className="block w-full truncate text-left font-medium underline-offset-2 hover:underline"
                    onClick={() => onOpen(row.host, row.path)}
                    title={`${row.host}${row.path}`}
                  >
                    {row.path}
                  </button>
                  <span className="text-xs text-muted-foreground">
                    {row.host}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.sessions || "—"}
                </TableCell>
                <TableCell>{topChannel(row.channels)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.credited.signup
                    ? formatCredited(row.credited.signup)
                    : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCredited(
                    COMMERCIAL.reduce((n, k) => n + (row.credited[k] ?? 0), 0),
                  ).replace(/^0$/, "—")}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.revenue.length
                    ? moneyLines(row.revenue, reportingCurrency).map((line) => (
                        <div key={line}>{line}</div>
                      ))
                    : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.search ? (
                    <>
                      {row.search.clicks}
                      <div className="text-xs text-muted-foreground">
                        position {row.search.position.toFixed(1)}
                      </div>
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
      {searchStatus !== "ok" ? (
        <p className="text-xs text-muted-foreground">
          {searchStatus === "not_connected"
            ? "Search Console is not connected, so search columns are empty. Connect it in Project Settings, Integrations."
            : "Search Console could not be read just now, so search columns are empty."}
        </p>
      ) : null}
      {landing.truncated > 0 ? (
        <p className="text-xs text-muted-foreground">
          {landing.truncated} more pages with fewer outcomes are not shown.
        </p>
      ) : null}
    </div>
  );
}
