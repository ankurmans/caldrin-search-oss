import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/client/components/ui/badge";
import { getAuditAiDiscoverability } from "@/serverFunctions/audit";
import type { AiBotRole } from "@/shared/ai-bots";

const ROLE_LABEL: Record<AiBotRole, string> = {
  search: "Finds pages for its answers",
  user: "Fetches a page when a person asks",
  training: "Collects data to train models",
};

function percent(part: number, whole: number) {
  return whole === 0 ? "-" : `${Math.round((part / whole) * 100)}%`;
}

/**
 * Whether AI assistants can reach and read the site. Bot access is the site's
 * robots.txt as it is now; the markup counts are from the crawl being viewed.
 */
export function AiDiscoverabilityView({
  auditRef,
  tabs,
}: {
  auditRef: { projectId: string; auditId: string };
  tabs: ReactNode;
}) {
  const query = useQuery({
    queryKey: ["audit-ai-discoverability", auditRef.auditId],
    queryFn: () => getAuditAiDiscoverability({ data: auditRef }),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const data = query.data;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {tabs}
      <div className="space-y-6 p-4">
        {query.isPending && (
          <p className="text-sm text-muted-foreground">Reading robots.txt…</p>
        )}
        {query.isError && (
          <p className="text-sm text-destructive">
            This report could not be loaded. Try again in a moment.
          </p>
        )}
        {data && (
          <>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">AI crawler access</h3>
              <p className="text-xs text-muted-foreground">
                {data.robotsFound
                  ? `From ${data.origin}/robots.txt as it is now.`
                  : `${data.origin} has no readable robots.txt, so crawlers treat every bot as allowed.`}{" "}
                robots.txt is a request, not enforcement: bot protection can
                still block a crawler that is listed as allowed.
              </p>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 font-medium">Crawler</th>
                    <th className="py-1 font-medium">Operator</th>
                    <th className="py-1 font-medium">What it does</th>
                    <th className="py-1 text-right font-medium">Access</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bots.map((bot) => (
                    <tr key={bot.token} className="border-t border-border">
                      <td className="py-1.5 font-mono text-xs">{bot.token}</td>
                      <td className="py-1.5">{bot.operator}</td>
                      <td className="py-1.5 text-muted-foreground">
                        {ROLE_LABEL[bot.role]}
                      </td>
                      <td className="py-1.5 text-right">
                        <Badge variant={bot.allowed ? "success" : "warning"}>
                          {bot.allowed ? "Allowed" : "Blocked"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground">
                Blocking a search crawler keeps the site out of that
                assistant&apos;s answers. Blocking a training crawler only opts
                out of model training.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Machine-readable markup</h3>
              <p className="text-xs text-muted-foreground">
                From this crawl, across {data.readability.pages} indexable pages
                that returned 200. Which schema type each page carries is not
                recorded yet.
              </p>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Coverage
                  label="Pages with structured data"
                  part={data.readability.withStructuredData}
                  whole={data.readability.pages}
                />
                <Coverage
                  label="Pages with complete Open Graph tags"
                  part={data.readability.withOpenGraph}
                  whole={data.readability.pages}
                />
              </dl>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Coverage({
  label,
  part,
  whole,
}: {
  label: string;
  part: number;
  whole: number;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold">{percent(part, whole)}</dd>
      <dd className="text-xs text-muted-foreground">
        {part} of {whole} pages
      </dd>
    </div>
  );
}
