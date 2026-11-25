// Cloudflare Browser Run bills browser time at $0.09 an hour. Every attempt is
// billed as its full timeout, not its measured time, so one attempt has one
// fixed price and the low end of the estimate is exact.
export const CLOUDFLARE_RENDER_TIMEOUT_MS = 20_000;
const CLOUDFLARE_USD_PER_BROWSER_HOUR = 0.09;
const CLOUDFLARE_USD_PER_ATTEMPT =
  (CLOUDFLARE_RENDER_TIMEOUT_MS / 3_600_000) * CLOUDFLARE_USD_PER_BROWSER_HOUR;
// TinyFish Fetch is free, so no credits are billed today.
export const TINYFISH_USD_PER_CREDIT = 0.0025;

/** Provider units a rendered audit used, counted per crawl chunk. */
export type RenderUsage = {
  cloudflareAttempts: number;
  tinyfishCredits: number;
};

function renderUsageUsd(usage: RenderUsage): number {
  return (
    usage.cloudflareAttempts * CLOUDFLARE_USD_PER_ATTEMPT +
    usage.tinyfishCredits * TINYFISH_USD_PER_CREDIT
  );
}

/**
 * What a rendered audit of `maxPages` pages can cost the provider. The low end
 * renders every page on Cloudflare, which is what most sites cost. The high
 * end is every page falling back to TinyFish after its Cloudflare attempt.
 */
function estimateRenderingUsd(maxPages: number) {
  return {
    low: renderUsageUsd({ cloudflareAttempts: maxPages, tinyfishCredits: 0 }),
    high: renderUsageUsd({
      cloudflareAttempts: maxPages,
      tinyfishCredits: maxPages,
    }),
  };
}

const RENDERING_COST_NOTE =
  "Sites that block our browser need an advanced renderer, which costs more.";

const usd = (value: number) => `$${(Math.ceil(value * 100) / 100).toFixed(2)}`;

function renderingCostText(maxPages: number) {
  const { low, high } = estimateRenderingUsd(maxPages);
  return `Costs ${usd(low)} to ${usd(high)} on your provider accounts.`;
}

export function renderingEstimateText(maxPages: number) {
  return `${renderingCostText(maxPages)} ${RENDERING_COST_NOTE}`;
}
