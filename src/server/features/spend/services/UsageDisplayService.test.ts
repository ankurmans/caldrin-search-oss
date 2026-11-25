import { describe, expect, it, vi } from "vitest";
import {
  limitsToSave,
  limitsToShow,
  presentUsage,
} from "./UsageDisplayService";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ db: {} }));

const none = { phase: "none" } as const;
const trial = { phase: "active", spentUsd: 0.5, budgetUsd: 2 } as const;
const stored = { dailyUsd: 5, monthlyUsd: 50, scheduledJobsPerDay: 10 };

describe("usage presentation by workspace mode", () => {
  it("shows provider charges only to a workspace on its own keys", () => {
    expect(presentUsage("byok", none)).toEqual({
      mode: "byok",
      showProviderCosts: true,
      allowance: null,
    });
    expect(presentUsage("cloud", none).showProviderCosts).toBe(false);
    expect(presentUsage("trial", trial).showProviderCosts).toBe(false);
  });

  it("shows a free test run what is left, not what was spent on its behalf", () => {
    expect(presentUsage("trial", trial).allowance).toEqual({
      remainingUsd: 1.5,
      budgetUsd: 2,
    });
    expect(presentUsage("cloud", none).allowance).toBeNull();
  });

  it("hides money limits from a workspace that cannot see charges, yet says one is active", () => {
    const cloud = presentUsage("cloud", none);
    expect(limitsToShow(cloud, stored)).toEqual({
      limits: { dailyUsd: null, monthlyUsd: null, scheduledJobsPerDay: 10 },
      moneyLimitActive: true,
    });
    expect(limitsToShow(presentUsage("byok", none), stored).limits).toEqual(
      stored,
    );
    expect(
      limitsToShow(cloud, { ...stored, dailyUsd: null, monthlyUsd: null })
        .moneyLimitActive,
    ).toBe(false);
  });

  it("keeps stored money limits when a form that cannot show them is saved", () => {
    const requested = {
      dailyUsd: null,
      monthlyUsd: null,
      scheduledJobsPerDay: 3,
    };
    expect(
      limitsToSave(presentUsage("cloud", none), stored, requested),
    ).toEqual({
      dailyUsd: 5,
      monthlyUsd: 50,
      scheduledJobsPerDay: 3,
    });
    expect(limitsToSave(presentUsage("byok", none), stored, requested)).toEqual(
      requested,
    );
  });
});
