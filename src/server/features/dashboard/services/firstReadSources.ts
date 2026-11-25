import { sort } from "remeda";
import { getWorkspaceMode } from "@/server/features/workspace/credentials";
import { explorePrompt } from "@/server/features/ai-search/services/promptExplorer";
import { DomainService } from "@/server/features/domain/services/DomainService";
import { GscService } from "@/server/features/gsc/services/GscService";
import { bestPagePerQuery } from "@/server/features/gsc/searchPerformanceReport";
import { ProjectContextRepository } from "@/server/features/project-context/repositories/ProjectContextRepository";
import { CompetitorExplorerService } from "@/server/features/site-explorer/services/CompetitorExplorerService";
import type { CustomerContext } from "@/server/lib/customer-context";
import { readPages } from "@/server/lib/scrape";
import { safeHostname, safeHttpUrl } from "@/shared/safe-url";

type Scope = {
  projectId: string;
  domain: string;
  locationCode: number;
  languageCode: string;
};

function isSiteHost(domain: string, host: string | null) {
  return host === domain || host?.endsWith(`.${domain}`) === true;
}

export async function readSearchConsole(scope: Scope, siteUrl: string) {
  const report = await GscService.getPerformance({
    projectId: scope.projectId,
    dateRange: "last_28_days",
    dimensions: ["query", "page"],
    dataState: "final",
    type: "web",
    rowLimit: 1000,
  });
  // A project may have been pointed at another property while this ran.
  if (report.siteUrl !== siteUrl) return null;

  const siteRows = report.rows.filter(
    (row) =>
      row.impressions > 0 &&
      isSiteHost(scope.domain, safeHostname(row.keys?.[1])),
  );
  const queries = sort(
    bestPagePerQuery(siteRows),
    (a, b) => b.impressions - a.impressions,
  );
  const closest = queries.find(
    (row) => row.position >= 8 && row.position <= 20,
  );
  return {
    queries,
    finding: closest && {
      kind: "search_query" as const,
      subject: closest.query,
      metric: closest.impressions,
      relatedMetric: closest.position,
      page: closest.page,
      observedAt: new Date().toISOString(),
      rangeStart: report.request.startDate,
      rangeEnd: report.request.endDate,
    },
  };
}

export async function readCrawlSample(domain: string, pages: string[]) {
  const targets = new Set([`https://${domain}/`]);
  for (const value of pages) {
    const url = safeHttpUrl(value);
    if (url && isSiteHost(domain, safeHostname(url))) targets.add(url);
    if (targets.size === 3) break;
  }
  const { pages: read } = await readPages([...targets], 3, undefined, 1);
  if (!read.length) return null;
  const untitled = read.filter((page) => !page.title?.trim());
  return {
    kind: untitled.length
      ? ("missing_titles" as const)
      : ("titles_found" as const),
    metric: untitled.length || read.length,
    relatedMetric: read.length,
    subject: domain,
    page: untitled[0]?.url ?? null,
    observedAt: new Date().toISOString(),
  };
}

export async function readAiSample(
  scope: Scope,
  queries: string[],
  customer: CustomerContext,
  brand: string | null,
) {
  const words = brand?.trim().toLowerCase();
  const prompts = [...new Set(queries.map((query) => query.trim()))]
    .filter(
      (query) =>
        query.length > 0 &&
        query.length <= 180 &&
        (!words || !query.toLowerCase().includes(words)),
    )
    .slice(0, 2);
  const findings = [];
  // Sequential calls give the trial meter the chance to settle the first
  // answer before the next answer's budget check.
  for (const query of prompts) {
    if ((await getWorkspaceMode(customer.organizationId)) !== "trial") break;
    const prompt = `What should someone searching for “${query}” know? Cite your sources.`;
    const read = await explorePrompt(
      {
        projectId: scope.projectId,
        models: ["perplexity"],
        prompt,
        webSearch: true,
      },
      customer,
    );
    const answer = read.results[0];
    if (
      answer?.status !== "success" ||
      !answer.text ||
      !answer.citations.length
    )
      continue;
    const citations = answer.citations.filter((item) =>
      isSiteHost(scope.domain, item.domain),
    );
    findings.push({
      kind: "ai_citations" as const,
      subject: query,
      metric: citations.length,
      relatedMetric: answer.citations.length,
      page: citations[0]?.url ?? null,
      observedAt: read.fetchedAt,
    });
  }
  return findings;
}

export async function readCompetitor(
  scope: Scope,
  customer: CustomerContext,
  allowTrialSpend: boolean,
) {
  const discovery = await CompetitorExplorerService.cachedDiscovery(
    { ...customer, projectId: scope.projectId },
    scope,
  );
  const discovered = discovery?.items.find(
    (item) => (item.organicKeywords ?? 0) > 0,
  );
  if (discovered && discovered.organicKeywords != null && discovery) {
    return {
      kind: "competitor_keywords" as const,
      subject: discovered.domain,
      metric: discovered.organicKeywords,
      observedAt: discovery.observedAt,
    };
  }
  const [competitor] = await ProjectContextRepository.listCompetitors(
    scope.projectId,
  );
  if (!competitor || competitor.domain === scope.domain) return null;
  const target = { ...scope, domain: competitor.domain };
  const overview =
    (await DomainService.getStoredOverview(target, customer)) ??
    (allowTrialSpend
      ? await DomainService.getOverview(target, customer)
      : null);
  if (!overview?.organicKeywords) return null;
  return {
    kind: "competitor_keywords" as const,
    subject: competitor.domain,
    metric: overview.organicKeywords,
    observedAt: overview.fetchedAt,
  };
}
