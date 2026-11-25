import { useEffect, useRef } from "react";
import type {
  FirstReadFinding,
  FirstReadSearchConsole,
} from "@/shared/first-read";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { QueryError } from "@/client/components/QueryState";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/client/components/ui/dialog";
import {
  getProjectFirstRead,
  markFirstReadEngagement,
} from "@/serverFunctions/dashboard";

const formatNumber = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});

const searchConsoleNotes: Record<
  Exclude<FirstReadSearchConsole, "read">,
  string
> = {
  skipped: "Connect Search Console to include data from Google.",
  no_history: "Search Console returned no queries in the last 28 days.",
  unavailable: "Search Console data was unavailable for this read.",
};

export function DashboardFirstRead({
  projectId,
  domain,
  siteUrl,
}: {
  projectId: string;
  domain: string;
  siteUrl: string | null;
}) {
  const query = useQuery({
    queryKey: ["projectFirstRead", projectId, domain, siteUrl],
    queryFn: () => getProjectFirstRead({ data: { projectId } }),
    refetchInterval: ({ state }) =>
      state.data?.status === "pending" ? 3000 : false,
  });
  const data = query.data?.status === "ready" ? query.data : null;
  const topFinding = data?.findings[0];
  const preview = topFinding ? findingText(topFinding) : null;
  const sourceNote =
    data && data.searchConsole !== "read"
      ? searchConsoleNotes[data.searchConsole]
      : null;
  const loadError = query.isError ? (
    <QueryError
      variant="inline"
      error={query.error}
      fallback="Could not load the first read"
      onRetry={() => void query.refetch()}
      isRetrying={query.isFetching}
    />
  ) : null;
  const queryClient = useQueryClient();
  const section = useRef<HTMLElement>(null);
  const hasFindings = Boolean(topFinding);
  useEffect(() => {
    const target = section.current;
    if (!target || !hasFindings) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      void markFirstReadEngagement({
        data: { projectId, milestone: "firstReadViewedAt" },
      })
        .then(() =>
          queryClient.invalidateQueries({
            queryKey: ["dashboardActivation", projectId],
          }),
        )
        .catch(() => undefined);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasFindings, projectId, queryClient]);

  return (
    <section
      ref={section}
      id="first-read"
      aria-labelledby="first-read-heading"
      className="flex w-fit max-w-full scroll-mt-4 flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border px-3 py-2.5"
    >
      <div className="min-w-0 max-w-[48rem] space-y-0.5">
        <h2
          id="first-read-heading"
          className="text-xs font-medium text-muted-foreground"
        >
          Your first read
        </h2>
        {preview ? (
          <p className="text-sm break-words">
            <span className="font-medium">{preview.heading}</span>{" "}
            <span className="text-muted-foreground">· {preview.metric}</span>
          </p>
        ) : data ? (
          <p className="text-sm text-muted-foreground">
            No findings yet.{sourceNote ? ` ${sourceNote}` : ""}
          </p>
        ) : loadError ? (
          loadError
        ) : query.data?.status === "no_site" ? (
          <p className="text-sm text-muted-foreground">
            Add a website to get a first read.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground" role="status">
            Checking {domain}…
          </p>
        )}
        {data && loadError}
      </div>
      {data && preview && (
        <Dialog>
          <DialogTrigger render={<Button variant="outline" size="sm" />}>
            View {data.findings.length}{" "}
            {data.findings.length === 1 ? "finding" : "findings"}
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl sm:p-6">
            <DialogHeader className="pr-8">
              <DialogTitle>Your first read</DialogTitle>
              {sourceNote && (
                <DialogDescription>{sourceNote}</DialogDescription>
              )}
            </DialogHeader>
            <ol className="divide-y divide-border border-t border-border">
              {data.findings.map((finding) => (
                <FindingRow
                  key={finding.rank}
                  finding={finding}
                  projectId={projectId}
                />
              ))}
            </ol>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

function FindingRow({
  finding,
  projectId,
}: {
  finding: FirstReadFinding;
  projectId: string;
}) {
  const { heading, metric, source } = findingText(finding);
  const params = { projectId };
  const readAt = new Date(finding.observedAt).toLocaleDateString(undefined, {
    dateStyle: "medium",
  });
  const range =
    finding.rangeStart && finding.rangeEnd
      ? ` · ${finding.rangeStart} to ${finding.rangeEnd}`
      : "";
  const onOpen = () => {
    void markFirstReadEngagement({
      data: { projectId, milestone: "firstFindingOpenedAt" },
    }).catch(() => undefined);
  };
  const className =
    "inline-flex items-center gap-1 text-sm font-medium hover:underline";
  const icon = <ArrowUpRight className="size-3.5" aria-hidden />;
  return (
    <li className="space-y-2 py-3">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">{heading}</p>
        <p className="text-sm">{metric}</p>
        {finding.page && (
          <p className="break-all text-xs text-muted-foreground">
            {finding.page}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {source}
          {range} · Read {readAt}
        </p>
      </div>
      {finding.kind === "search_query" ? (
        <Link
          to="/p/$projectId/search-performance"
          params={params}
          search={{
            tab: "striking",
            queryText: finding.subject,
            queryMatch: "equals",
          }}
          className={className}
          onClick={onOpen}
        >
          Search performance{icon}
        </Link>
      ) : finding.kind === "missing_titles" ||
        finding.kind === "titles_found" ? (
        <Link
          to="/p/$projectId/audit"
          params={params}
          className={className}
          onClick={onOpen}
        >
          Technical SEO{icon}
        </Link>
      ) : finding.kind === "ai_citations" ? (
        <Link
          to="/p/$projectId/prompt-explorer"
          params={params}
          className={className}
          onClick={onOpen}
        >
          Prompt Explorer{icon}
        </Link>
      ) : (
        <Link
          to="/p/$projectId/domain"
          params={params}
          search={{ domain: finding.subject }}
          className={className}
          onClick={onOpen}
        >
          Site Explorer{icon}
        </Link>
      )}
    </li>
  );
}

function findingText(finding: FirstReadFinding) {
  const value = formatNumber.format(finding.metric);
  const related =
    finding.relatedMetric === null
      ? ""
      : formatNumber.format(finding.relatedMetric);
  switch (finding.kind) {
    case "search_query":
      return {
        heading: `“${finding.subject}” is within striking distance`,
        metric: `${value} ${finding.metric === 1 ? "impression" : "impressions"} · Average position ${related}`,
        source: "Google Search Console · Best page in the sample",
      };
    case "missing_titles":
      return {
        heading: "Pages missing titles",
        metric: `${value} of ${related} sampled pages`,
        source: "Light crawl",
      };
    case "titles_found":
      return {
        heading: "Page titles found",
        metric: `${value} of ${related} sampled pages`,
        source: "Light crawl",
      };
    case "ai_citations":
      return {
        heading: `AI citations for “${finding.subject}”`,
        metric: `${value} of ${related} citations linked to your site`,
        source: "Perplexity · One answer",
      };
    case "organic_keywords":
    case "competitor_keywords":
      return {
        heading:
          finding.kind === "competitor_keywords"
            ? `Competitor footprint for ${finding.subject}`
            : `Organic keyword footprint for ${finding.subject}`,
        metric: `${value} estimated ranking keywords`,
        source: "Site Explorer · DataForSEO estimate",
      };
  }
}
