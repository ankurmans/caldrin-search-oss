import { createFileRoute, notFound } from "@tanstack/react-router";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { pageHead } from "@/client/lib/pageHead";
import { getCodingAgentPanel } from "@/serverFunctions/coding-agent";

export const Route = createFileRoute("/_app/p/$projectId/coding-agent")({
  head: () => ({
    meta: [
      ...pageHead("Coding Agent Visibility").meta,
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  loader: async ({ params }) => {
    const panel = await getCodingAgentPanel({
      data: { projectId: params.projectId },
    });
    if (panel === false) throw notFound();
    return panel;
  },
  component: CodingAgentPage,
});

function safeSourceHref(value: string) {
  const url = URL.parse(value);
  return url?.protocol === "https:" && !url.username && !url.password
    ? url.href
    : undefined;
}

const modeLabel = {
  brokered_search: "Caldrin-filtered search",
  documentation_index: "Scoped documentation lookup",
  search_disabled: "Search disabled",
};

function CodingAgentPage() {
  const result = Route.useLoaderData();
  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Coding Agent Visibility
        </h1>
        <p className="text-sm text-muted-foreground">
          Review what the coding agent recommended in an isolated test.
        </p>
      </header>
      {result ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Test prompt</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="whitespace-pre-wrap break-words">
                {result.panel.prompt}
              </p>
              <p className="text-sm text-muted-foreground">
                {result.panel.model} · {modeLabel[result.panel.mode]} ·{" "}
                {result.runs.length} {result.runs.length === 1 ? "run" : "runs"}{" "}
                ·{" "}
                <time dateTime={result.panel.capturedAt}>
                  {result.panel.capturedAt.slice(0, 10)} UTC
                </time>
              </p>
            </CardContent>
          </Card>
          {result.runs.map((run) => (
            <Card key={run.slot}>
              <CardHeader>
                <CardTitle>Run {run.slot}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="whitespace-pre-wrap break-words">{run.answer}</p>
                {run.query && (
                  <p className="break-words text-sm">
                    {result.panel.mode === "documentation_index"
                      ? "Lookup query"
                      : "Search query"}{" "}
                    · {run.query}
                  </p>
                )}
                <ul className="space-y-1 text-sm">
                  {result.sources
                    .filter((source) => source.slot === run.slot)
                    .map((source) => {
                      const href = safeSourceHref(source.url);
                      return href ? (
                        <li
                          key={source.url + source.evidence}
                          className="break-all"
                        >
                          <span className="text-muted-foreground">
                            {source.evidence === "answer_link"
                              ? "Linked in answer"
                              : result.panel.mode === "documentation_index"
                                ? "From the documentation index"
                                : "Returned by search"}{" "}
                            ·{" "}
                          </span>
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
                            {href}
                          </a>
                        </li>
                      ) : null;
                    })}
                </ul>
                <p className="text-sm text-muted-foreground">
                  {run.inputTokens.toLocaleString()} input tokens ·{" "}
                  {run.outputTokens.toLocaleString()} output tokens · $
                  {(run.listRateMicroUsd / 1_000_000).toFixed(6)} at list rates
                </p>
              </CardContent>
            </Card>
          ))}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          No verified test panels are available for this project yet.
        </p>
      )}
    </main>
  );
}
