// The hosted plans. Prices are charged by Polar, so priceUsd here is only for
// display and must match the Polar product. providerCapUsd is what the
// workspace may spend on our provider keys in a UTC month: about a tenth of the
// price, which is what keeps the margin when a workspace uses all of it. Using
// your own keys is free and has no plan.
export const BILLING_PLANS = [
  {
    key: "starter",
    name: "Starter",
    priceUsd: 19,
    providerCapUsd: 1.5,
    allowance: "10 prompts on 4 engines, checked daily",
  },
  {
    key: "growth",
    name: "Growth",
    priceUsd: 49,
    providerCapUsd: 4.9,
    allowance: "25 prompts on 4 engines daily, plus Perplexity weekly on 5",
  },
  {
    key: "pro",
    name: "Pro",
    priceUsd: 99,
    providerCapUsd: 9.9,
    allowance: "50 prompts on 4 engines daily, plus Perplexity weekly on 10",
  },
  {
    key: "scale",
    name: "Scale",
    priceUsd: 199,
    providerCapUsd: 19.9,
    allowance: "100 prompts on 4 engines daily, plus Perplexity weekly on 25",
  },
  {
    key: "agency",
    name: "Agency",
    priceUsd: 399,
    providerCapUsd: 40,
    allowance: "Several client projects under one allowance",
  },
] as const;

export type BillingPlanKey = (typeof BILLING_PLANS)[number]["key"];

export function billingPlan(key: string | null | undefined) {
  return BILLING_PLANS.find((plan) => plan.key === key) ?? null;
}
