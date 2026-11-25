import {
  GscNotConnectedError,
  GscService,
} from "@/server/features/gsc/services/GscService";
import type { GscRow } from "@/server/features/content/rules/opportunityRules";
import { ContentRepository } from "@/server/features/content/repositories/ContentRepository";
import { storeFor } from "@/server/features/content/services/shopifyConnection";
import {
  simulatedGscRows,
  SIMULATED_SHOP_DOMAIN,
} from "@/server/features/content/shopify/simulatedShop";
import { OpportunityRepository } from "../repositories/OpportunityRepository";
import type { EngineInputs, PageWindowRow } from "../types";

const WINDOW_DAYS = 28;
const GSC_LAG_DAYS = 3;

function isoDay(offsetDays: number, now: Date): string {
  return new Date(now.getTime() - offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

async function readPageWindow(
  projectId: string,
  startDate: string,
  endDate: string,
): Promise<PageWindowRow[]> {
  const result = await GscService.getPerformance({
    projectId,
    dimensions: ["page"],
    startDate,
    endDate,
    rowLimit: 1000,
  });
  const rows: PageWindowRow[] = [];
  for (const r of result.rows) {
    const page = r.keys?.[0];
    if (!page) continue;
    rows.push({
      page,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    });
  }
  return rows;
}

async function readLiveGsc(
  projectId: string,
  now: Date,
): Promise<Pick<EngineInputs, "gsc" | "pageWindows">> {
  const result = await GscService.getPerformance({
    projectId,
    dimensions: ["query", "page"],
    dateRange: "last_28_days",
    rowLimit: 1000,
  });
  const rows: GscRow[] = [];
  for (const r of result.rows) {
    const [query, page] = r.keys ?? [];
    if (!query || !page) continue;
    rows.push({
      query,
      page,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    });
  }
  const currentEnd = isoDay(GSC_LAG_DAYS, now);
  const currentStart = isoDay(GSC_LAG_DAYS + WINDOW_DAYS - 1, now);
  const previousEnd = isoDay(GSC_LAG_DAYS + WINDOW_DAYS, now);
  const previousStart = isoDay(GSC_LAG_DAYS + 2 * WINDOW_DAYS - 1, now);
  const [current, previous] = await Promise.all([
    readPageWindow(projectId, currentStart, currentEnd),
    readPageWindow(projectId, previousStart, previousEnd),
  ]);
  return {
    gsc: {
      source: "gsc",
      rows,
      windowStart: result.request.startDate,
      windowEnd: result.request.endDate,
    },
    pageWindows: {
      current,
      previous,
      currentStart,
      currentEnd,
      previousStart,
      previousEnd,
    },
  };
}

function brandTermsFor(
  project: Awaited<ReturnType<typeof OpportunityRepository.getProjectBrand>>,
  shopName: string | null,
  shopDomain: string | null,
): string[] {
  const terms = [project?.brandName, project?.name, shopName];
  const domains = [project?.domain, shopDomain];
  for (const domain of domains) {
    const host = domain?.replace(/^https?:\/\//, "").split("/")[0] ?? "";
    const label = host.replace(/^www\./, "").split(".")[0];
    if (label) terms.push(label);
  }
  return [...new Set(terms.filter((t): t is string => !!t && t.length > 1))];
}

// Reads the project's own stored and connected data. Read-only: Search Console
// and the store snapshot are free reads, and nothing paid is called here. A
// source that cannot be read is reported in `unavailable`, never replaced.
export async function loadEngineInputs(
  projectId: string,
  now: Date = new Date(),
): Promise<EngineInputs> {
  const unavailable: EngineInputs["unavailable"] = [];
  const connection = await ContentRepository.getConnection(projectId);
  const simulated = connection?.mode === "simulated";

  let store: EngineInputs["store"] = null;
  if (connection) {
    try {
      store = await (await storeFor(connection)).readSnapshot();
    } catch {
      unavailable.push({
        source: "shopify",
        reason:
          "The Shopify store could not be read, so catalog rules did not run.",
      });
    }
  }

  let gsc: EngineInputs["gsc"] = null;
  let pageWindows: EngineInputs["pageWindows"] = null;
  if (simulated) {
    gsc = {
      source: "simulated",
      rows: simulatedGscRows,
      windowStart: isoDay(GSC_LAG_DAYS + WINDOW_DAYS - 1, now),
      windowEnd: isoDay(GSC_LAG_DAYS, now),
    };
  } else {
    try {
      ({ gsc, pageWindows } = await readLiveGsc(projectId, now));
    } catch (error) {
      unavailable.push({
        source: "gsc",
        reason:
          error instanceof GscNotConnectedError
            ? "Search Console is not connected for this project."
            : "Search Console could not be read.",
      });
    }
  }

  const [audit, project] = await Promise.all([
    OpportunityRepository.latestAuditIssues(projectId),
    OpportunityRepository.getProjectBrand(projectId),
  ]);
  return {
    gsc,
    pageWindows,
    store,
    storeMode: connection ? (simulated ? "simulated" : "live") : null,
    audit,
    brandTerms: brandTermsFor(
      project,
      store?.shopName ?? null,
      simulated ? SIMULATED_SHOP_DOMAIN : (connection?.shopDomain ?? null),
    ),
    unavailable,
  };
}
