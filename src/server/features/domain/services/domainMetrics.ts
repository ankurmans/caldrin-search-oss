import { z } from "zod";
import type { LabsChannelMetrics } from "@/server/lib/dataforseo";

// Organic ranking metrics as the provider aggregates them for one market. The
// same shape comes from the live domain overview and from each month of the
// historical overview, so both are mapped by one function.
export const organicMetricsSchema = z.object({
  keywords: z.number().nullable(),
  traffic: z.number().nullable(),
  // The provider's estimate of what this traffic would cost as paid clicks.
  trafficValueUsd: z.number().nullable(),
  positions: z
    .object({
      top1: z.number(),
      top2to3: z.number(),
      top4to10: z.number(),
      top11to20: z.number(),
      top21to50: z.number(),
      top51to100: z.number(),
    })
    .nullable(),
  movement: z.object({
    newKeywords: z.number().nullable(),
    risingKeywords: z.number().nullable(),
    decliningKeywords: z.number().nullable(),
    // Only the monthly history reports lost keywords.
    lostKeywords: z.number().nullable(),
  }),
});

type OrganicMetrics = z.infer<typeof organicMetricsSchema>;

const n = (value: number | null | undefined) => value ?? 0;
const rounded = (value: number | null | undefined) =>
  value == null ? null : Math.round(value);

export function mapOrganicMetrics(
  organic: LabsChannelMetrics | null | undefined,
): OrganicMetrics {
  const hasBuckets = organic != null && organic.pos_1 != null;
  return {
    keywords: rounded(organic?.count),
    traffic: rounded(organic?.etv),
    trafficValueUsd: rounded(organic?.estimated_paid_traffic_cost),
    positions:
      organic && hasBuckets
        ? {
            top1: n(organic.pos_1),
            top2to3: n(organic.pos_2_3),
            top4to10: n(organic.pos_4_10),
            top11to20: n(organic.pos_11_20),
            top21to50:
              n(organic.pos_21_30) +
              n(organic.pos_31_40) +
              n(organic.pos_41_50),
            top51to100:
              n(organic.pos_51_60) +
              n(organic.pos_61_70) +
              n(organic.pos_71_80) +
              n(organic.pos_81_90) +
              n(organic.pos_91_100),
          }
        : null,
    movement: {
      newKeywords: organic?.is_new ?? null,
      risingKeywords: organic?.is_up ?? null,
      decliningKeywords: organic?.is_down ?? null,
      lostKeywords: organic?.is_lost ?? null,
    },
  };
}
