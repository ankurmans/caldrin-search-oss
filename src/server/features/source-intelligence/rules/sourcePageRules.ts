import type { Approach } from "@/types/schemas/source-intelligence";

export const PAGE_KINDS = [
  "vendor_page",
  "comparison",
  "independent_review",
  "guide",
  "other",
] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

/** Longest page text sent to the model. The rest is not read. */
export const MAX_PAGE_CHARS = 12_000;

const escapeRegExp = (value: string) =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/**
 * Which of these brands the page text names, by name or domain. Found by
 * matching the text itself so a reading never claims a mention the page does
 * not contain.
 */
export function findMentions(
  text: string,
  brands: { name: string; domain: string }[],
): string[] {
  const lower = text.toLowerCase();
  return brands
    .filter((brand) => {
      const name = brand.name.trim();
      const byName =
        name.length >= 3 &&
        new RegExp(String.raw`\b${escapeRegExp(name)}\b`, "i").test(text);
      const domain = brand.domain.trim().toLowerCase();
      return byName || (domain.length > 0 && lower.includes(domain));
    })
    .map((brand) => brand.name);
}

/**
 * What the reading suggests, from what the page is and who it names. A
 * suggestion to investigate: being named on a page does not guarantee a
 * future AI citation.
 */
export function suggestApproach(input: {
  pageKind: PageKind;
  competitorDomain: boolean;
  namesBrand: boolean;
}): Approach {
  if (input.namesBrand) return "already_covered";
  if (input.pageKind === "vendor_page")
    return input.competitorDomain ? "owned_content_gap" : "no_clear_gap";
  if (input.pageKind === "comparison") return "comparison_opportunity";
  if (input.pageKind === "independent_review" || input.pageKind === "guide")
    return "independent_source_opportunity";
  return "no_clear_gap";
}
