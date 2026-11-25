import { assertTrialBudget, recordTrialSpend } from "./trial";
import type { CustomerContext } from "@/server/lib/customer-context";

export type ResearchSpend = {
  provider: "openrouter" | "dataforseo" | "tinyfish";
  operation: string;
  costUsd: number;
};

/** Runs paid research once a trial workspace is known to have budget left. */
export async function withResearchAdmission<T>(
  customer: CustomerContext,
  work: () => Promise<T>,
): Promise<T> {
  await assertTrialBudget(customer.organizationId);
  return work();
}

/** Adds the research's cost to a trial workspace's spend, after it finished. */
export async function recordResearchSpend(
  customer: CustomerContext,
  spend: ResearchSpend[],
) {
  const costUsd = spend.reduce((sum, item) => sum + item.costUsd, 0);
  try {
    await recordTrialSpend(customer.organizationId, costUsd);
  } catch (error) {
    // A metering failure must not discard completed research.
    console.error("Research spend not recorded", {
      organizationId: customer.organizationId,
      spend,
      error,
    });
  }
}
