import { useState } from "react";
import { Button } from "@/client/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import type { getAiCrawlerActivity } from "@/serverFunctions/ai-crawlers";

type Row = Awaited<
  ReturnType<typeof getAiCrawlerActivity>
>["pathDiagnostics"][number];
const FILTERS = ["All paths", "Errors", "With AI evidence"] as const;

export function CrawlerPathTable({ rows }: { rows: Row[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All paths");
  const visible = rows.filter((row) => {
    if (filter === "Errors") return row.errors > 0;
    if (filter === "With AI evidence")
      return row.citedUrls.length + row.retrievedUrls.length > 0;
    return true;
  });
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Page diagnostics</h3>
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label="Page filters"
        >
          {FILTERS.map((name) => (
            <Button
              key={name}
              size="xs"
              variant={filter === name ? "default" : "outline"}
              aria-pressed={filter === name}
              onClick={() => setFilter(name)}
            >
              {name}
            </Button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Up to 50 paths, with errors first. AI evidence comes from saved answers
        in the main market. A path can appear in either data source.
      </p>
      {visible.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Path</TableHead>
                <TableHead className="text-right">Visits</TableHead>
                <TableHead className="text-right">4xx / 5xx</TableHead>
                <TableHead>Last visit</TableHead>
                <TableHead>Saved AI evidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.path}>
                  <TableCell className="max-w-64 break-words whitespace-normal">
                    {row.path}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.visits ? row.visits.toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.visits ? row.errors.toLocaleString() : "—"}
                  </TableCell>
                  <TableCell>{row.lastDay ?? "No visit recorded"}</TableCell>
                  <TableCell>
                    <span className="text-sm">
                      {[
                        row.citedUrls.length ? "Cited" : "",
                        row.retrievedUrls.length ? "Retrieved" : "",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No paths match this filter.
        </p>
      )}
    </section>
  );
}
