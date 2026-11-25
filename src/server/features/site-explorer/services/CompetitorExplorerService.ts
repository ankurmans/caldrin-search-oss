import { z } from "zod";
import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import { OpportunityRefusal } from "@/server/features/opportunities/types";
import { ProjectContextService } from "@/server/features/project-context/services/ProjectContextService";
import { SpendService } from "@/server/features/spend/services/SpendService";
import { getWorkspaceMode } from "@/server/features/workspace/credentials";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { dataforseoPricing } from "@/server/lib/dataforseo/pricing";
import { hasDataforseoAccess } from "@/server/lib/provider-access";
import { buildCacheKey, getCached, setCached } from "@/server/lib/r2-cache";
import { normaliseDomain } from "../rules/gapMerge";
import { CompetitorDismissalRepository } from "../repositories/CompetitorDismissalRepository";
import { KeywordGapRepository } from "../repositories/KeywordGapRepository";
import type { DismissalKind } from "@/shared/competitor-dismissal";
import type { ExplorerContext } from "./KeywordGapExplorerService";

const DISCOVERY_OPERATION = "site_explorer_competitors";
const DISCOVERY_LIMIT = 30;
// Discovered competitors are kept for a week, so reopening the tab never
// spends again; a refresh is an explicit paid action.
const DISCOVERY_TTL_SECONDS = 7 * 24 * 60 * 60;

const discoverySchema = z.object({
  target: z.string(),
  locationCode: z.number(),
  languageCode: z.string(),
  observedAt: z.string(),
  costUsd: z.number(),
  items: z.array(
    z.object({
      domain: z.string(),
      sharedKeywords: z.number().nullable(),
      avgPosition: z.number().nullable(),
      organicKeywords: z.number().nullable(),
      organicTraffic: z.number().nullable(),
    }),
  ),
});
type CompetitorDiscovery = z.infer<typeof discoverySchema>;

/**
 * The stored discovery as a person should see it: domains they ruled out are
 * moved to `dismissed` (kept, with why, and restorable), and a domain another
 * project of the same organization ruled out is offered as a suggestion. The
 * paid read itself is left whole, so dismissing never costs a second lookup.
 */
async function withDismissals(
  ctx: ExplorerContext,
  discovery: CompetitorDiscovery,
) {
  const dismissals = await CompetitorDismissalRepository.list(ctx.projectId);
  const dismissedKind = new Map(
    dismissals.map((row) => [row.domain, row.kind]),
  );
  const visible = discovery.items.filter(
    (item) => !dismissedKind.has(item.domain),
  );
  const elsewhere = await CompetitorDismissalRepository.listFromOtherProjects(
    ctx.organizationId,
    ctx.projectId,
    visible.map((item) => item.domain),
  );
  return {
    ...discovery,
    items: visible,
    dismissed: dismissals.map((row) => ({
      ...row,
      stats: discovery.items.find((item) => item.domain === row.domain) ?? null,
    })),
    suggestedKinds: Object.fromEntries(
      elsewhere.map((row) => [row.domain, row.kind]),
    ),
  };
}

const usd = (n: number) => `$${n.toFixed(2)}`;

async function targetAndMarket(
  projectId: string,
  market?: { locationCode?: number; languageCode?: string },
) {
  const project = await OpportunityRepository.getProjectBrand(projectId);
  const target = project?.domain ? normaliseDomain(project.domain) : null;
  return {
    target,
    locationCode: market?.locationCode ?? project?.locationCode ?? 2840,
    languageCode: market?.languageCode ?? project?.languageCode ?? "en",
  };
}

async function cacheKeyFor(
  organizationId: string,
  projectId: string,
  market: { target: string; locationCode: number; languageCode: string },
) {
  return buildCacheKey("site-explorer:competitors", {
    organizationId,
    projectId,
    ...market,
  });
}

// Saved competitors, each with its markets and the date a keyword gap last
// read it. Stored data only.
async function list(projectId: string) {
  return KeywordGapRepository.listCompetitorsWithMarkets(projectId);
}

// The last discovery for this project and market, if one is kept. Free: this
// is what the tab shows on open.
async function cachedDiscovery(
  ctx: ExplorerContext,
  market?: { locationCode?: number; languageCode?: string },
) {
  const resolved = await targetAndMarket(ctx.projectId, market);
  if (!resolved.target) return null;
  const key = await cacheKeyFor(ctx.organizationId, ctx.projectId, {
    ...resolved,
    target: resolved.target,
  });
  const parsed = discoverySchema.safeParse(await getCached(key));
  return parsed.success ? withDismissals(ctx, parsed.data) : null;
}

async function estimateDiscovery(
  ctx: ExplorerContext,
  market?: { locationCode?: number; languageCode?: string },
) {
  const resolved = await targetAndMarket(ctx.projectId, market);
  const base = {
    available: false,
    reason: null as string | null,
    target: resolved.target,
    locationCode: resolved.locationCode,
    languageCode: resolved.languageCode,
    estimatedUsd: null as number | null,
    basis: null as string | null,
    remainingUsd: null as number | null,
  };
  if (!resolved.target) {
    return {
      ...base,
      reason:
        "This project has no domain set, so there is nothing to search from.",
    };
  }
  if (!(await hasDataforseoAccess())) {
    return {
      ...base,
      reason:
        (await getWorkspaceMode(ctx.organizationId)) === "byok"
          ? "This workspace uses its own provider keys and has no DataForSEO key saved."
          : "DataForSEO is not set up for this workspace.",
    };
  }
  const estimatedUsd = dataforseoPricing.domain.competitors({
    target: resolved.target,
    locationCode: resolved.locationCode,
    languageCode: resolved.languageCode,
    limit: DISCOVERY_LIMIT,
  });
  const remaining = await SpendService.getRemainingUsd(ctx.projectId);
  const found = {
    ...base,
    estimatedUsd,
    basis: `One DataForSEO competitors-domain read, up to ${DISCOVERY_LIMIT} domains that rank for the same keywords. Upper bound.`,
    remainingUsd: remaining?.usd ?? null,
  };
  if (remaining && estimatedUsd > remaining.usd) {
    return {
      ...found,
      reason: `The estimated cost of ${usd(estimatedUsd)} would pass this project's ${remaining.period} spend limit.`,
    };
  }
  return { ...found, available: true };
}

// The paid read. Needs an explicit call; opening the page never reaches it.
async function discover(
  ctx: ExplorerContext,
  market?: { locationCode?: number; languageCode?: string },
) {
  const quote = await estimateDiscovery(ctx, market);
  if (!quote.available || quote.estimatedUsd === null || !quote.target) {
    throw new OpportunityRefusal(
      `${quote.reason ?? "Competitor discovery is not available."} Nothing was fetched.`,
    );
  }
  const scope = {
    projectId: ctx.projectId,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
  };
  await SpendService.assertWithinLimits(scope, {
    estimatedUsd: quote.estimatedUsd,
    provider: "dataforseo",
    operation: DISCOVERY_OPERATION,
  });
  const page = await createDataforseoClient(ctx).domain.competitors({
    target: quote.target,
    locationCode: quote.locationCode,
    languageCode: quote.languageCode,
    limit: DISCOVERY_LIMIT,
  });
  await SpendService.recordCost(scope, {
    provider: "dataforseo",
    operation: DISCOVERY_OPERATION,
    estimatedUsd: quote.estimatedUsd,
    costUsd: quote.estimatedUsd,
  });
  const result: CompetitorDiscovery = {
    target: quote.target,
    locationCode: quote.locationCode,
    languageCode: quote.languageCode,
    observedAt: new Date().toISOString(),
    costUsd: quote.estimatedUsd,
    items: page.items.flatMap((item) => {
      const domain = item.domain ? normaliseDomain(item.domain) : null;
      if (!domain || domain === quote.target) return [];
      const organic = item.full_domain_metrics?.organic;
      return [
        {
          domain,
          sharedKeywords: item.intersections ?? null,
          avgPosition: item.avg_position ?? null,
          organicKeywords: organic?.count ?? null,
          organicTraffic: organic?.etv ?? null,
        },
      ];
    }),
  };
  await setCached(
    await cacheKeyFor(ctx.organizationId, ctx.projectId, {
      target: quote.target,
      locationCode: quote.locationCode,
      languageCode: quote.languageCode,
    }),
    result,
    DISCOVERY_TTL_SECONDS,
  );
  return withDismissals(ctx, result);
}

// Add competitors through project memory, so they are the same competitors
// backlinks, AI visibility and the opportunity engine already read.
async function add(
  ctx: ExplorerContext,
  input: { domains: string[]; discovered?: boolean },
): Promise<string[]> {
  const domains = [
    ...new Set(
      input.domains
        .map((raw) => normaliseDomain(raw))
        .filter((domain): domain is string => domain !== null),
    ),
  ];
  if (domains.length === 0) {
    throw new OpportunityRefusal(
      "Enter a valid domain like example.com. Real top-level domains only.",
    );
  }
  // Adding a domain on purpose overrules an earlier dismissal.
  await Promise.all(
    domains.map((domain) =>
      CompetitorDismissalRepository.remove(ctx.projectId, domain),
    ),
  );
  const before = new Set(
    (await KeywordGapRepository.listCompetitorsWithMarkets(ctx.projectId)).map(
      (competitor) => competitor.domain,
    ),
  );
  await ProjectContextService.applyContextUpdates(
    ctx.projectId,
    [{ addCompetitors: domains.map((domain) => ({ domain })) }],
    ctx.actor ?? "user",
  );
  if (input.discovered) {
    await KeywordGapRepository.markDiscovered(
      ctx.projectId,
      domains.filter((domain) => !before.has(domain)),
    );
  }
  return domains;
}

// Rule domains out as competitors. A saved one stops being a competitor; the
// domain is not removed from anything else, so it stays available as a link
// prospect.
async function dismiss(
  ctx: ExplorerContext,
  input: { domains: string[]; kind: DismissalKind },
): Promise<number> {
  const domains = [
    ...new Set(
      input.domains
        .map((raw) => normaliseDomain(raw))
        .filter((domain): domain is string => domain !== null),
    ),
  ];
  if (domains.length === 0) throw new OpportunityRefusal("Not a domain.");
  await Promise.all(
    domains.map((domain) =>
      CompetitorDismissalRepository.upsert(ctx.projectId, domain, input.kind),
    ),
  );
  const saved = new Set(
    (await KeywordGapRepository.listCompetitorsWithMarkets(ctx.projectId)).map(
      (competitor) => competitor.domain,
    ),
  );
  const savedAndDismissed = domains.filter((domain) => saved.has(domain));
  if (savedAndDismissed.length > 0) {
    await ProjectContextService.applyContextUpdates(
      ctx.projectId,
      [{ removeCompetitors: savedAndDismissed }],
      ctx.actor ?? "user",
    );
  }
  return domains.length;
}

async function restore(ctx: ExplorerContext, domain: string): Promise<void> {
  const normalized = normaliseDomain(domain);
  if (!normalized) throw new OpportunityRefusal("Not a domain.");
  await CompetitorDismissalRepository.remove(ctx.projectId, normalized);
}

async function remove(ctx: ExplorerContext, domain: string): Promise<void> {
  const normalized = normaliseDomain(domain);
  if (!normalized) throw new OpportunityRefusal("Not a domain.");
  await ProjectContextService.applyContextUpdates(
    ctx.projectId,
    [{ removeCompetitors: [normalized] }],
    ctx.actor ?? "user",
  );
}

async function setMarkets(
  ctx: ExplorerContext,
  input: {
    domain: string;
    markets: Array<{ locationCode: number; languageCode: string }>;
  },
): Promise<void> {
  const domain = normaliseDomain(input.domain);
  const found =
    domain !== null &&
    (await KeywordGapRepository.setCompetitorMarkets(
      ctx.projectId,
      domain,
      input.markets,
    ));
  if (!found) {
    throw new OpportunityRefusal(
      "That competitor is not saved for this project.",
    );
  }
}

async function listViews(projectId: string, tableKey: string) {
  return KeywordGapRepository.listViews(projectId, tableKey);
}

async function saveView(
  projectId: string,
  input: { tableKey: string; name: string; config: string },
) {
  await KeywordGapRepository.saveView({ projectId, ...input });
}

async function deleteView(projectId: string, id: string) {
  await KeywordGapRepository.deleteView(projectId, id);
}

export const CompetitorExplorerService = {
  list,
  cachedDiscovery,
  estimateDiscovery,
  discover,
  add,
  dismiss,
  restore,
  remove,
  setMarkets,
  listViews,
  saveView,
  deleteView,
};
