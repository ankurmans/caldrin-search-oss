import { sort } from "remeda";
import { ClaimExtraction } from "./ClaimExtraction";
import { useEffect, useState } from "react";
import { captureClientEvent } from "@/client/lib/posthog";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { claimCategories } from "@/shared/ai-claims";
import { getClaimOverview } from "@/serverFunctions/ai-claims";
import { ClaimEvidencePanel } from "./ClaimEvidencePanel";
import { ClaimFacts } from "./ClaimFacts";

const engines = [
  ["chatgpt", "ChatGPT"],
  ["gemini", "Gemini"],
  ["google_ai_overview", "Google AI Overviews"],
  ["google_ai_mode", "Google AI Mode"],
  ["claude", "Claude"],
  ["perplexity", "Perplexity"],
];

export function ClaimIntelligencePage({ projectId }: { projectId: string }) {
  useEffect(() => {
    captureClientEvent("claims:opened");
  }, []);
  const [tab, setTab] = useState<"claims" | "facts">("claims");
  const [selected, setSelected] = useState("");
  const [engine, setEngine] = useState("");
  const [market, setMarket] = useState("");
  const [category, setCategory] = useState<(typeof claimCategories)[number]>();
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [view, setView] = useState("");
  const filters = {
    engine: engine || undefined,
    market: market ? Number(market) : undefined,
    category,
    since: since || undefined,
    until: until || undefined,
  };
  const query = useQuery({
    queryKey: ["claims", projectId, filters],
    queryFn: () => getClaimOverview({ data: { projectId, ...filters } }),
    refetchInterval: (current) =>
      current.state.data?.jobs.some((job) =>
        ["queued", "running"].includes(job.status),
      )
        ? 5000
        : false,
  });
  const refresh = () => {
    void query.refetch();
  };
  const result = query.data;
  const recentCutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const clusters =
    result?.clusters.filter((cluster) =>
      view === "repeated"
        ? cluster.count > 1
        : view === "new"
          ? (cluster.firstSeen ?? "") >= recentCutoff
          : !view || cluster.status === view,
    ) ?? [];
  const cluster = clusters.find((row) => row.id === selected) ?? clusters[0];
  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-5 md:px-6">
      <header>
        <h1 className="text-2xl font-semibold">Claim Intelligence</h1>
        <p className="text-sm text-muted-foreground">
          Find repeated factual assertions in saved AI answers and compare them
          with approved facts.
        </p>
      </header>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={tab === "claims" ? "default" : "outline"}
          onClick={() => setTab("claims")}
        >
          Claims
        </Button>
        <Button
          size="sm"
          variant={tab === "facts" ? "default" : "outline"}
          onClick={() => setTab("facts")}
        >
          Facts registry
        </Button>
      </div>
      {query.error && (
        <p role="alert">{getStandardErrorMessage(query.error)}</p>
      )}
      {query.isPending && (
        <p className="text-sm text-muted-foreground">
          Loading Claim Intelligence…
        </p>
      )}
      {result && tab === "facts" && (
        <ClaimFacts projectId={projectId} data={result} refresh={refresh} />
      )}
      {result && tab === "claims" && (
        <>
          <ClaimExtraction
            projectId={projectId}
            result={result}
            refresh={refresh}
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select
              aria-label="Engine"
              className="h-9 rounded-md border bg-background px-2"
              value={engine}
              onChange={(e) => setEngine(e.target.value)}
            >
              <option value="">All engines</option>
              {engines.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="Market"
              className="h-9 rounded-md border bg-background px-2"
              value={market}
              onChange={(e) => setMarket(e.target.value)}
            >
              <option value="">All markets</option>
              {sort(
                [...new Set(result.runs.map((row) => row.locationCode))],
                (a, b) => a - b,
              ).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <select
              aria-label="Category"
              className="h-9 rounded-md border bg-background px-2"
              value={category ?? ""}
              onChange={(e) =>
                setCategory(
                  claimCategories.find((value) => value === e.target.value),
                )
              }
            >
              <option value="">All categories</option>
              {claimCategories.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <label className="flex items-center gap-1">
              From{" "}
              <Input
                type="date"
                value={since}
                onChange={(e) => setSince(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-1">
              To{" "}
              <Input
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </label>
            <select
              aria-label="Claim status"
              className="h-9 rounded-md border bg-background px-2"
              value={view}
              onChange={(e) => setView(e.target.value)}
            >
              <option value="">All claims</option>
              <option value="repeated">Repeated</option>
              <option value="new">First observed this week</option>
              <option value="review">Needs review</option>
              <option value="confirmed">Confirmed conflict</option>
              <option value="consistent">Consistent</option>
              <option value="unverified">Unverified</option>
            </select>
          </div>
          {result.sampled && (
            <p className="text-sm text-muted-foreground">
              Showing the latest 1,000 occurrences. Narrow the dates for a
              smaller cohort.
            </p>
          )}
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <section className="min-w-0 rounded-xl border bg-card p-4">
              <h2 className="mb-2 font-medium">Observed claims</h2>
              {clusters.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No observations match this view.
                </p>
              )}
              {clusters.slice(0, 100).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="block w-full break-words border-t px-2 py-3 text-left text-sm hover:bg-muted aria-pressed:bg-muted"
                  aria-pressed={cluster?.id === item.id}
                  onClick={() => setSelected(item.id)}
                >
                  <span className="font-medium">
                    {item.proposition.predicate} ·{" "}
                    {item.proposition.polarity === "denies" ? "Denies " : ""}
                    {item.proposition.value}
                  </span>
                  <span className="mt-1 block text-muted-foreground">
                    {item.count} answers · {item.occurrenceCount} occurrences ·{" "}
                    {item.prompts} prompts · {item.runs} runs · {item.engines}{" "}
                    engines
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {item.firstSeen?.slice(0, 10)}
                    {item.lastSeen && item.lastSeen !== item.firstSeen
                      ? ` – ${item.lastSeen.slice(0, 10)}`
                      : ""}
                  </span>
                </button>
              ))}
              {clusters.length > 100 && (
                <p className="text-sm text-muted-foreground">
                  Showing the top 100 groups. Narrow the filters for more.
                </p>
              )}
            </section>
            {cluster && (
              <ClaimEvidencePanel
                key={cluster.id}
                projectId={projectId}
                cluster={cluster}
                reviewer={result.reviewer}
                refresh={refresh}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
