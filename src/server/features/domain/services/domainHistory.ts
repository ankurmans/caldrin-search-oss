import { waitUntil } from "cloudflare:workers";
import { sortBy } from "remeda";
import { z } from "zod";
import type { CustomerContext } from "@/server/lib/customer-context";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { HISTORICAL_RANK_MAX_MONTHS } from "@/server/lib/dataforseo/pricing";
import { buildCacheKey, getCached, setCached } from "@/server/lib/r2-cache";
import { parseResearchTargetOrThrow } from "@/server/lib/domainUtils";
import {
  mapOrganicMetrics,
  organicMetricsSchema,
} from "@/server/features/domain/services/domainMetrics";

const DOMAIN_HISTORY_TTL_SECONDS = 12 * 60 * 60;

const domainHistoryResultSchema = z.object({
  domain: z.string(),
  // Oldest first. `month` is YYYY-MM, the month the provider aggregated.
  months: z.array(organicMetricsSchema.extend({ month: z.string() })),
  fetchedAt: z.string(),
});

type DomainHistoryResult = z.infer<typeof domainHistoryResultSchema>;

/** First day of the month `monthsBack` months before `now`, as YYYY-MM-DD. */
function windowStart(now: Date, monthsBack: number): string {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1),
  );
  return start.toISOString().slice(0, 10);
}

type HistoryInput = {
  projectId: string;
  domain: string;
  locationCode: number;
  languageCode: string;
};

// One entry per hostname and window start, shared by every scope like the
// live overview (the endpoint always covers the hostname plus subdomains).
async function historyCacheKey(
  input: HistoryInput,
  billingCustomer: CustomerContext,
  now: Date,
) {
  const domain = parseResearchTargetOrThrow(input.domain).hostname;
  const dateFrom = windowStart(now, HISTORICAL_RANK_MAX_MONTHS - 1);
  return {
    domain,
    dateFrom,
    cacheKey: await buildCacheKey("domain:history", {
      organizationId: billingCustomer.organizationId,
      projectId: input.projectId,
      domain,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      dateFrom,
    }),
  };
}

/** The history already read for this market, or null. Never calls the provider. */
export async function getStoredDomainHistory(
  input: HistoryInput,
  billingCustomer: CustomerContext,
): Promise<DomainHistoryResult | null> {
  const { cacheKey } = await historyCacheKey(
    input,
    billingCustomer,
    new Date(),
  );
  const cached = domainHistoryResultSchema.safeParse(await getCached(cacheKey));
  return cached.success ? cached.data : null;
}

export async function getDomainHistory(
  input: HistoryInput,
  billingCustomer: CustomerContext,
): Promise<DomainHistoryResult> {
  const now = new Date();
  const { domain, dateFrom, cacheKey } = await historyCacheKey(
    input,
    billingCustomer,
    now,
  );

  const cached = domainHistoryResultSchema.safeParse(await getCached(cacheKey));
  if (cached.success) return cached.data;

  const items = await createDataforseoClient(
    billingCustomer,
  ).domain.historicalRankOverview({
    target: domain,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    dateFrom,
  });

  const months = sortBy(
    items.flatMap((item) =>
      item.year != null && item.month != null
        ? [
            {
              month: `${item.year}-${String(item.month).padStart(2, "0")}`,
              ...mapOrganicMetrics(item.metrics?.organic),
            },
          ]
        : [],
    ),
    (row) => row.month,
  );

  const result: DomainHistoryResult = {
    domain,
    months,
    fetchedAt: now.toISOString(),
  };

  if (months.length > 0) {
    waitUntil(
      setCached(cacheKey, result, DOMAIN_HISTORY_TTL_SECONDS).catch((error) => {
        console.error("domain.history.cache-write failed:", error);
      }),
    );
  }
  return result;
}
