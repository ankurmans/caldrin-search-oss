import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { sortBy } from "remeda";
import { CardShell } from "@/client/components/CardShell";
import { QueryState } from "@/client/components/QueryState";
import { Badge } from "@/client/components/ui/badge";
import { Skeleton } from "@/client/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { checkAiCrawlerAccess } from "@/serverFunctions/ai-crawlers";

const ROLE_LABELS = {
  search: "Search",
  user: "On request",
  training: "Training",
} as const;

// Visits sort high to low first, then low to high, then back to the list order.
const NEXT_ORDER = { none: "desc", desc: "asc", asc: "none" } as const;

export function AccessCard({ projectId }: { projectId: string }) {
  const [order, setOrder] = useState<"none" | "desc" | "asc">("none");
  const query = useQuery({
    queryKey: ["ai-crawlers", projectId, "access"],
    queryFn: () => checkAiCrawlerAccess({ data: { projectId } }),
  });
  return (
    <CardShell title="Crawl access">
      <QueryState
        query={query}
        loading={<Skeleton className="h-40 w-full" />}
        errorFallback="Failed to read robots.txt"
      >
        {(data) => {
          const bots =
            order === "none"
              ? data.bots
              : sortBy(data.bots, [(bot) => bot.recentHits ?? 0, order]);
          return (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                {data.robotsFound
                  ? `Read from ${data.origin}/robots.txt just now.`
                  : `No robots.txt found at ${data.origin}, so every crawler is allowed.`}{" "}
                Blocking a search crawler keeps the site out of that assistant's
                answers. Blocking a training crawler only opts out of model
                training.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Crawler</TableHead>
                    <TableHead>Operator</TableHead>
                    <TableHead>Used for</TableHead>
                    <TableHead>robots.txt</TableHead>
                    <TableHead
                      className="text-right"
                      aria-sort={
                        order === "none"
                          ? "none"
                          : order === "desc"
                            ? "descending"
                            : "ascending"
                      }
                    >
                      {data.hasVisitData ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={() => setOrder(NEXT_ORDER[order])}
                        >
                          Visits, 28 days
                          {order === "desc" ? (
                            <ArrowDown className="size-3" />
                          ) : order === "asc" ? (
                            <ArrowUp className="size-3" />
                          ) : null}
                        </button>
                      ) : (
                        "Visits, 28 days"
                      )}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bots.map((bot) => (
                    <TableRow key={bot.token}>
                      <TableCell className="font-medium">{bot.token}</TableCell>
                      <TableCell>{bot.operator}</TableCell>
                      <TableCell>{ROLE_LABELS[bot.role]}</TableCell>
                      <TableCell>
                        <Badge variant={bot.allowed ? "success" : "warning"}>
                          {bot.allowed ? "Allowed" : "Blocked"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {bot.recentHits ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          );
        }}
      </QueryState>
    </CardShell>
  );
}
