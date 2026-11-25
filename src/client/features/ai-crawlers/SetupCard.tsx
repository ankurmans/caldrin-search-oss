import { CardShell } from "@/client/components/CardShell";
import { CopyButton } from "@/client/components/CopyButton";
import {
  KeyPanel,
  type CrawlerKeyState,
} from "@/client/features/ai-crawlers/CrawlerKey";

/** Worker snippet and access-log upload, for sites that are not on Cloudflare or Vercel. */
export function SetupCard({ keyState }: { keyState: CrawlerKeyState }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const snippet = keyState.setup?.snippet ?? "";
  return (
    <CardShell title="Worker snippet and access logs">
      <div className="flex flex-col gap-4 text-sm">
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>Create a key below. It is shown once.</li>
          <li>
            In Cloudflare, create a Worker with the code below and route it to
            your site (for example example.com/*).
          </li>
          <li>
            Add the key to that Worker as a secret named{" "}
            <code>CALDRIN_CRAWLER_KEY</code>.
          </li>
        </ol>
        <KeyPanel keyState={keyState} />
        <div className="flex flex-col gap-1 rounded-md border p-3">
          <p className="font-medium">Have access logs instead?</p>
          <p className="text-muted-foreground">
            Send an Apache or nginx access log with the same key. Each visit
            counts on the day the log gives it; sending the same file twice
            counts it twice.
          </p>
          <pre className="overflow-auto rounded-md bg-muted/40 p-2 text-xs">
            {`curl -X POST --data-binary @access.log \\
  -H "Authorization: Bearer ${keyState.newKey ?? "YOUR_KEY"}" \\
  ${origin}/api/crawler-logs`}
          </pre>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="font-medium">Worker code</p>
            <CopyButton value={snippet} successMessage="Worker code copied" />
          </div>
          <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
            {snippet}
          </pre>
          <p className="text-xs text-muted-foreground">
            The Worker passes every request through unchanged and reports only
            the path, status and user agent of requests that name an AI crawler,
            after the response is sent. Query strings are never sent.
          </p>
        </div>
      </div>
    </CardShell>
  );
}
