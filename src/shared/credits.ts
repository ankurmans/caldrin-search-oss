// A credit is $0.001 of provider spend. Estimates that an agent or a person
// approves before a paid check runs are stated in credits and in dollars; this
// is the one conversion between them.
export const CREDITS_PER_USD = 1000;

// DataForSEO's price for one Google Ads search_volume live call (up to 1,000
// keywords). Local keyword research adds one call to each search.
export const LOCAL_VOLUME_COST_USD = 0.09;

export function roundUsd(value: number) {
  return Math.round(value * 100000) / 100000;
}

export function creditsToUsd(credits: number) {
  return credits / CREDITS_PER_USD;
}

/** Credits for one provider USD cost, rounded up per call. */
export function creditsForProviderUsd(usd: number): number {
  return Math.ceil(roundUsd(usd) * CREDITS_PER_USD);
}
