// Per-audit page bounds. Shared so the launch form, the input schema, and the
// server-side tier gate all read the same numbers and can't drift apart.
export const MIN_AUDIT_PAGES = 10;
export const DEFAULT_AUDIT_PAGES = 50;
export const FREE_MAX_AUDIT_PAGES = 50;
export const PAID_MAX_AUDIT_PAGES = 10_000;
// A rendered audit's crawl stops after this long, leaving time for Lighthouse
// and finalization within a day.
export const RENDERED_CRAWL_TIME_LIMIT_HOURS = 22;
