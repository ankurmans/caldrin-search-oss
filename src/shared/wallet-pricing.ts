import type { AiEngine } from "./ai-visibility";

export const WALLET_CENTS_PER_CREDIT = 4;

export const WALLET_PACKS = [20, 50, 100].map((priceUsd) => ({
  priceUsd,
  credits: (priceUsd * 100) / WALLET_CENTS_PER_CREDIT,
}));

export const PREMIUM_WALLET_ESTIMATES = {
  claude: 200,
  perplexity: 10,
} as const;

export function walletCreditsPerAnswer(
  engine: AiEngine,
  collection: "queued" | "live",
): number {
  if (engine === "claude" || engine === "perplexity")
    return PREMIUM_WALLET_ESTIMATES[engine];
  return collection === "queued" ? 1 : 4;
}

export const PLATFORM_PLANS = {
  team: {
    label: "Team",
    priceUsd: 19,
    monthlyCredits: 400,
    seats: 5,
    guests: 0,
  },
  agency: {
    label: "Agency",
    priceUsd: 49,
    monthlyCredits: 800,
    seats: 10,
    guests: 25,
  },
} as const;

export type PlatformPlan = keyof typeof PLATFORM_PLANS;

export const WALLET_REFILL_MIN_USD = 20;
export const WALLET_REFILL_MAX_USD = 999_999;

export function creditsForWalletRefill(amountUsd: number) {
  return (amountUsd * 100) / WALLET_CENTS_PER_CREDIT;
}
