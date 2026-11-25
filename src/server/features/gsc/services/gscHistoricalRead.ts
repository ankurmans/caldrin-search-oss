import { z } from "zod";
import { DashboardCacheService } from "@/server/features/dashboard/services/DashboardCacheService";
import type { GscConnection } from "@/server/features/gsc/repositories/GscConnectionRepository";
import {
  createGscClient,
  type GscSearchAnalyticsRequest,
} from "@/server/lib/gscClient";
import { buildSearchAnalyticsRequest } from "../searchAnalytics";

const ROW_LIMIT = 1000;

const rowSchema = z.object({
  keys: z.array(z.string()).optional(),
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number(),
  position: z.number(),
});

async function readHistory(
  connection: GscConnection,
  request: GscSearchAnalyticsRequest,
  dimension: "query" | "page",
) {
  return DashboardCacheService.readThrough({
    namespace: DashboardCacheService.gscNamespace(
      connection.projectId,
      "history",
    ),
    organizationId: connection.organizationId,
    params: {
      dimension,
      siteUrl: connection.siteUrl,
      accountId: connection.gscAccountId,
      updatedAt: connection.updatedAt,
      startDate: request.startDate,
      endDate: request.endDate,
      dataState: request.dataState,
    },
    schema: z.array(rowSchema),
    maxAgeMs: 86_400_000,
    load: () =>
      createGscClient({
        userId: connection.connectedByUserId,
        gscAccountId: connection.gscAccountId ?? undefined,
      }).querySearchAnalytics(connection.siteUrl, {
        ...request,
        rowLimit: ROW_LIMIT,
        startRow: undefined,
      }),
  });
}

/** One bounded page per dimension from the property's longest supported range. */
export async function backfillGscHistory(connection: GscConnection) {
  await Promise.allSettled(
    (["query", "page"] as const).map((dimension) =>
      readHistory(
        connection,
        buildSearchAnalyticsRequest({
          projectId: connection.projectId,
          dateRange: "last_16_months",
          dimensions: [dimension],
        }),
        dimension,
      ),
    ),
  );
}

export async function getGscHistoricalRows(
  connection: GscConnection,
  request: GscSearchAnalyticsRequest,
) {
  const dimension = request.dimensions?.[0];
  const offset = request.startRow ?? 0;
  const limit = request.rowLimit ?? 250;
  if (
    request.type !== "web" ||
    request.dimensionFilterGroups?.length ||
    request.dimensions?.length !== 1 ||
    (dimension !== "query" && dimension !== "page") ||
    offset + limit > ROW_LIMIT
  )
    return null;

  const history = await readHistory(connection, request, dimension);
  return history.value.slice(offset, offset + limit);
}
