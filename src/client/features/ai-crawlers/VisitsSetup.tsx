import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CardShell } from "@/client/components/CardShell";
import { CopyButton } from "@/client/components/CopyButton";
import { Button } from "@/client/components/ui/button";
import { CloudflareCard } from "@/client/features/ai-crawlers/CloudflareCard";
import {
  KeyPanel,
  useCrawlerKey,
  type CrawlerKeyState,
} from "@/client/features/ai-crawlers/CrawlerKey";
import { SetupCard } from "@/client/features/ai-crawlers/SetupCard";
import {
  detectAiCrawlerHost,
  getAiCrawlerActivity,
} from "@/serverFunctions/ai-crawlers";
import { agentMessage, developerMessage } from "@/shared/ai-crawler-handoff";
import {
  CLOSED_HOSTS,
  SITE_HOST_LABELS,
  type SiteHost,
} from "@/shared/site-host";

/** Visit counts are optional: only the steps for where the site is hosted are shown. */
export function VisitsSetup({ projectId }: { projectId: string }) {
  const [showAll, setShowAll] = useState(false);
  const keyState = useCrawlerKey(projectId);
  const hostQuery = useQuery({
    queryKey: ["ai-crawlers", projectId, "host"],
    queryFn: () => detectAiCrawlerHost({ data: { projectId } }),
    staleTime: 10 * 60 * 1000,
  });
  const detected = hostQuery.data?.host ?? "unknown";
  const domain = hostQuery.data?.domain ?? "your site";
  const view = showAll ? "unknown" : detected;
  const closed = CLOSED_HOSTS.includes(view);

  return (
    <>
      <CardShell title="See who actually visits (optional)">
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            Crawl access above works with no setup. Counting real visits needs a
            connection to wherever your site is hosted.
          </p>
          {hostQuery.data ? (
            <p>
              {detected === "unknown"
                ? "We could not tell where your site is hosted, so every option is shown."
                : `Your site looks like it is hosted on ${SITE_HOST_LABELS[detected]}.`}{" "}
              {detected !== "unknown" ? (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-sm"
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll ? "Show only these steps" : "Not right? Show all"}
                </Button>
              ) : null}
            </p>
          ) : null}
          {closed ? (
            <p>
              {SITE_HOST_LABELS[view]} does not share request logs, so Caldrin
              cannot count crawler visits for this site. Everything in Crawl
              access above still works.
            </p>
          ) : null}
        </div>
      </CardShell>
      {closed ? null : (
        <HostSteps
          projectId={projectId}
          view={view}
          domain={domain}
          keyState={keyState}
        />
      )}
    </>
  );
}

function HostSteps({
  projectId,
  view,
  domain,
  keyState,
}: {
  projectId: string;
  view: SiteHost;
  domain: string;
  keyState: CrawlerKeyState;
}) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const onCloudflare = view === "cloudflare" || view === "unknown";
  const needsKey = view !== "cloudflare";
  const handoff = { host: view, domain, origin, key: keyState.newKey };
  const message = developerMessage(handoff);
  const agentTask = agentMessage(handoff);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      {onCloudflare ? <CloudflareSection projectId={projectId} /> : null}
      {view === "vercel" || view === "unknown" ? (
        <CardShell title="Vercel">
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              Vercel keeps no request history to read later, so it sends each
              request to Caldrin as it happens through a log drain (Pro and
              Enterprise plans). Create a key, then add the drain in Vercel
              under Team Settings, Drains, Add Drain, Logs:
            </p>
            <KeyPanel keyState={keyState} />
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>
                Sources: Functions, Edge Functions and Static Files.
                Environment: Production. Only the project for this site. Keep
                sampling at 100%.
              </li>
              <li>
                Destination: a custom HTTP endpoint at{" "}
                <code>{origin}/api/crawler-logs</code>, format JSON.
              </li>
              <li>
                One custom header, on a single line:{" "}
                <code>
                  Authorization: Bearer {keyState.newKey ?? "YOUR_KEY"}
                </code>
              </li>
            </ol>
            <p className="text-xs text-muted-foreground">
              Only visits after the drain exists are counted. Vercel bills
              drains by the data sent, so scope it to this one project. Caldrin
              keeps the path, status and user agent of requests that name an AI
              crawler and drops the rest.
            </p>
          </div>
        </CardShell>
      ) : null}
      {view === "unknown" || view === "netlify" || view === "wordpress" ? (
        <SetupCard keyState={keyState} />
      ) : null}
      <CardShell title="Send these steps to someone else">
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">
            Not the person who runs the hosting? Copy a message for them, or a
            task for an AI agent (Claude Code, Codex, Cursor) that manages it.
            {needsKey && !keyState.newKey
              ? " Create a key above first, so the message includes it."
              : ""}
          </p>
          <HandoffBlock
            title="For a person"
            text={message}
            copied="Message copied"
          />
          <HandoffBlock
            title="For an AI agent"
            text={agentTask}
            copied="Task copied"
          />
        </div>
      </CardShell>
    </div>
  );
}

function HandoffBlock({
  title,
  text,
  copied,
}: {
  title: string;
  text: string;
  copied: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="font-medium">{title}</p>
        <CopyButton value={text} successMessage={copied} />
      </div>
      <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  );
}

function CloudflareSection({ projectId }: { projectId: string }) {
  // Shares the activity query, so the card and the table never disagree.
  const query = useQuery({
    queryKey: ["ai-crawlers", projectId, "activity", 28],
    queryFn: () => getAiCrawlerActivity({ data: { projectId, days: 28 } }),
  });
  return query.data ? (
    <CloudflareCard
      projectId={projectId}
      connection={query.data.cloudflare}
      reusableZone={query.data.reusableZone}
    />
  ) : null;
}
