import { describe, expect, it } from "vitest";
import { mapOrganicMetrics } from "@/server/features/domain/services/domainMetrics";

describe("mapOrganicMetrics", () => {
  it("folds the provider's ten position buckets into six bands", () => {
    const metrics = mapOrganicMetrics({
      count: 146.4,
      etv: 134.6,
      estimated_paid_traffic_cost: 99.5,
      pos_1: 1,
      pos_2_3: 2,
      pos_4_10: 3,
      pos_11_20: 4,
      pos_21_30: 5,
      pos_31_40: 6,
      pos_41_50: 7,
      pos_51_60: 8,
      pos_61_70: 9,
      pos_71_80: 10,
      pos_81_90: 11,
      pos_91_100: 12,
    });

    expect(metrics.keywords).toBe(146);
    expect(metrics.traffic).toBe(135);
    expect(metrics.trafficValueUsd).toBe(100);
    expect(metrics.positions).toEqual({
      top1: 1,
      top2to3: 2,
      top4to10: 3,
      top11to20: 4,
      top21to50: 18,
      top51to100: 50,
    });
  });

  it("reports no distribution and no lost count when the provider sent none", () => {
    const metrics = mapOrganicMetrics({ count: 144, etv: 130 });

    expect(metrics.positions).toBeNull();
    expect(metrics.movement.lostKeywords).toBeNull();
  });
});
