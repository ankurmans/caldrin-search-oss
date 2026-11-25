/**
 * Why a domain that ranks for the same keywords is not a competitor. Every
 * kind keeps the domain eligible as a link prospect: a directory that lists
 * the competition is a place to be listed, which is the opposite of a rival.
 */
export const DISMISSAL_KINDS = [
  "directory",
  "publisher",
  "marketplace",
  "not_competitor",
] as const;
export type DismissalKind = (typeof DISMISSAL_KINDS)[number];

export const DISMISSAL_LABELS: Record<DismissalKind, string> = {
  directory: "Directory or listing site",
  publisher: "Publisher or media",
  marketplace: "Marketplace or platform",
  not_competitor: "Other, not a competitor",
};
