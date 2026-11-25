import { parseResearchTarget } from "@/shared/researchScope";

/** The bare hostname of a domain or URL, or null when it is missing or invalid. */
export function siteHostname(input: string | null | undefined): string | null {
  if (!input) return null;
  const parsed = parseResearchTarget(input);
  return parsed.ok ? parsed.target.hostname : null;
}

export function isSameSite(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const first = siteHostname(a);
  return first !== null && first === siteHostname(b);
}
