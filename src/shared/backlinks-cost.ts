// Backlinks API pricing, uniform across endpoints (dataforseo.com/pricing/backlinks/backlinks).
const BACKLINKS_TASK_USD = 0.024;
const BACKLINKS_ROW_USD = 0.000036;

/** What one Backlinks API read of `rows` rows costs the provider account. */
export function backlinksReadUsd(rows: number) {
  return BACKLINKS_TASK_USD + rows * BACKLINKS_ROW_USD;
}
