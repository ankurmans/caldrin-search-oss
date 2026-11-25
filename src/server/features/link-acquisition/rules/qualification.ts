import type { LinkRecommendation } from "@/shared/link-acquisition";
import type { MergedLinkCandidate } from "./linkGapMerge";

export type QualificationSettings = {
  minCompetitors: number;
  preferredLanguage: string | null;
  softMaxSpamScore: number;
  softMinDomainRank: number;
  weightCompetitors: number;
  weightAuthority: number;
  weightContext: number;
  weightFollow: number;
  weightPersistence: number;
  weightEffort: number;
  pursueAt: number;
  skipBelow: number;
};

export const DEFAULT_QUALIFICATION_SETTINGS: QualificationSettings = {
  minCompetitors: 1,
  preferredLanguage: null,
  softMaxSpamScore: 40,
  softMinDomainRank: 100,
  weightCompetitors: 30,
  weightAuthority: 15,
  weightContext: 20,
  weightFollow: 10,
  weightPersistence: 10,
  weightEffort: 15,
  pursueAt: 60,
  skipBelow: 35,
};

/** The slice of a page-level evidence row qualification reads. */
export type QualificationEvidence = {
  competitorDomain: string | null;
  urlFrom: string;
  urlTo: string;
  pageTitle: string | null;
  pageLanguage: string | null;
  semanticLocation: string | null;
  isNofollow: boolean;
  isSponsored: boolean;
  isUgc: boolean;
  lostDate: string | null;
};

type QualificationFactor = {
  factor: string;
  points: number;
  max: number;
  detail: string;
};

type Qualification = {
  score: number;
  recommendation: LinkRecommendation;
  factors: QualificationFactor[];
  confidence: "low" | "medium" | "high";
  /** What this assessment could not see. */
  limitations: string[];
  whyFound: string;
  whyRelevant: string;
  whyRealistic: string;
  nextAction: string;
  /** Pages on competitor sites that carry the links, from page-level evidence. */
  competitorDestinations: string[];
  /** The link attributes seen; sponsored links are never counted as earned. */
  attributes: { nofollow: boolean; sponsored: boolean; ugc: boolean };
};

const EDITORIAL_PLACEMENTS = new Set(["main", "article", "section"]);
const TEMPLATE_PLACEMENTS = new Set(["footer", "nav", "header", "aside"]);

const EFFORT: Record<string, number> = {
  organization: 0.8,
  forums: 0.7,
  blogs: 0.6,
  cms: 0.6,
  ecommerce: 0.6,
  news: 0.5,
  wiki: 0.3,
};

function daysSince(value: string | null, now: Date) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : (now.getTime() - time) / 86_400_000;
}

function share(max: number, fraction: number) {
  return Math.round(max * fraction * 10) / 10;
}

// A spam-flagged site is never recommended outright, however many competitors
// it links to, but it stays a "review", not a "skip".
function isSpammy(
  candidate: MergedLinkCandidate,
  settings: QualificationSettings,
) {
  return (
    candidate.spamScore !== null &&
    candidate.spamScore >= settings.softMaxSpamScore
  );
}

function recommend(
  score: number,
  belowMinimum: boolean,
  spammy: boolean,
  settings: QualificationSettings,
): LinkRecommendation {
  if (belowMinimum) return "skip";
  if (score >= settings.pursueAt && !spammy) return "pursue";
  return score < settings.skipBelow ? "skip" : "review";
}

/**
 * Scores a link-gap candidate from what is stored about it. Every factor
 * reports its points and the reason, domain rank and spam score only move
 * points and never exclude a candidate, and anything the provider did not
 * report counts as unknown, not as good or bad.
 */
export function qualifyCandidate(input: {
  candidate: MergedLinkCandidate;
  evidence: QualificationEvidence[];
  comparedCompetitors: number;
  settings: QualificationSettings;
  now?: Date;
}): Qualification {
  const { candidate, evidence, settings } = input;
  const now = input.now ?? new Date();
  const factors: QualificationFactor[] = [];
  const limitations: string[] = [];

  // Competitor placements.
  const placements = Math.min(candidate.competitorCount, 3);
  factors.push({
    factor: "Competitor placements",
    points: share(
      settings.weightCompetitors,
      [0, 0.4, 0.75, 1][placements] ?? 1,
    ),
    max: settings.weightCompetitors,
    detail: `Links to ${candidate.competitorCount} of ${input.comparedCompetitors} compared competitors.`,
  });

  // Authority and spam: soft inputs.
  const rank = candidate.domainRank;
  let authority = 0.5;
  let authorityDetail = "Domain Rank not reported.";
  if (rank !== null) {
    authority =
      rank >= settings.softMinDomainRank * 2
        ? 1
        : rank >= settings.softMinDomainRank
          ? 0.7
          : 0.2;
    authorityDetail = `Domain Rank ${rank} on the provider's 0 to 1000 scale (soft floor ${settings.softMinDomainRank}).`;
  } else {
    limitations.push("Domain Rank was not reported.");
  }
  if (
    candidate.spamScore !== null &&
    candidate.spamScore >= settings.softMaxSpamScore
  ) {
    authority *= 0.5;
    authorityDetail += ` Provider spam score ${candidate.spamScore} is at or above ${settings.softMaxSpamScore}; this is a heuristic, not a verdict.`;
  }
  factors.push({
    factor: "Authority",
    points: share(settings.weightAuthority, authority),
    max: settings.weightAuthority,
    detail: authorityDetail,
  });

  // Context: where on the page the link sits.
  const locations = [
    ...evidence.map((row) => row.semanticLocation),
    ...candidate.competitors.map((c) => c.topPlacement),
  ].filter((value): value is string => !!value);
  const editorial = locations.filter((l) => EDITORIAL_PLACEMENTS.has(l)).length;
  const template = locations.filter((l) => TEMPLATE_PLACEMENTS.has(l)).length;
  let context = 0.5;
  let contextDetail = "Placement on the page not reported.";
  if (locations.length > 0) {
    context = editorial > template ? 1 : template > editorial ? 0.25 : 0.5;
    contextDetail = `${editorial} editorial and ${template} template placements (footer, navigation, sidebar).`;
  } else {
    limitations.push("Where the links sit on the page was not reported.");
  }
  factors.push({
    factor: "Context",
    points: share(settings.weightContext, context),
    max: settings.weightContext,
    detail: contextDetail,
  });

  // Link attributes.
  const attributes = {
    nofollow: evidence.some((row) => row.isNofollow),
    sponsored: evidence.some((row) => row.isSponsored),
    ugc: evidence.some((row) => row.isUgc),
  };
  const pages = candidate.competitors.reduce(
    (sum, c) => sum + (c.referringPages ?? 0),
    0,
  );
  const nofollowPages = candidate.competitors.reduce(
    (sum, c) => sum + (c.nofollowPages ?? 0),
    0,
  );
  let follow = 0.5;
  let followDetail = "Follow status not reported.";
  if (attributes.sponsored) {
    follow = 0;
    followDetail =
      "A link on this site carries rel=sponsored: it is a paid or sponsored placement and counts as sponsored, not earned.";
  } else if (pages > 0) {
    const ratio = nofollowPages / pages;
    follow = ratio <= 0.2 ? 1 : ratio >= 0.8 ? 0.2 : 0.6;
    followDetail = `${nofollowPages} of ${pages} linking pages are nofollow.`;
  } else {
    limitations.push("Follow status was not reported.");
  }
  factors.push({
    factor: "Link attributes",
    points: share(settings.weightFollow, follow),
    max: settings.weightFollow,
    detail: followDetail,
  });

  // Persistence.
  const age = daysSince(candidate.firstSeen, now);
  let persistence = 0.4;
  let persistenceDetail = "First-seen date not reported.";
  if (candidate.lostDate) {
    persistence = 0;
    persistenceDetail =
      "The provider no longer finds at least one of these links.";
  } else if (age !== null) {
    persistence = age >= 365 ? 1 : age >= 90 ? 0.7 : age >= 30 ? 0.4 : 0.2;
    persistenceDetail = `Oldest link first seen ${Math.round(age)} days ago.`;
  }
  factors.push({
    factor: "Persistence",
    points: share(settings.weightPersistence, persistence),
    max: settings.weightPersistence,
    detail: persistenceDetail,
  });

  // Effort, from the kind of site.
  const platform = candidate.competitors.find(
    (c) => c.topPlatform,
  )?.topPlatform;
  factors.push({
    factor: "Effort",
    points: share(
      settings.weightEffort,
      platform ? (EFFORT[platform] ?? 0.5) : 0.5,
    ),
    max: settings.weightEffort,
    detail: platform
      ? `Site type reported as ${platform}.`
      : "Site type not reported.",
  });

  let score = Math.round(
    (factors.reduce((sum, f) => sum + f.points, 0) /
      Math.max(
        1,
        factors.reduce((sum, f) => sum + f.max, 0),
      )) *
      100,
  );

  const languages = [
    ...new Set(
      evidence.map((row) => row.pageLanguage).filter((l): l is string => !!l),
    ),
  ];
  if (
    settings.preferredLanguage &&
    languages.length > 0 &&
    !languages.includes(settings.preferredLanguage)
  ) {
    score = Math.max(0, score - 20);
    limitations.push(
      `Linking pages are in ${languages.join(", ")}, not ${settings.preferredLanguage}.`,
    );
  }
  if (evidence.length === 0) {
    limitations.push(
      "No linking page has been read, so relevance and context are not assessed.",
    );
  }

  const belowMinimum = candidate.competitorCount < settings.minCompetitors;
  const spammy = isSpammy(candidate, settings);
  if (spammy) {
    limitations.push(
      `Provider spam score ${candidate.spamScore} is at or above ${settings.softMaxSpamScore}, so this is not recommended outright.`,
    );
  }
  const recommendation = recommend(score, belowMinimum, spammy, settings);

  const names = candidate.competitors.map((c) => c.competitorDomain).join(", ");
  const titled = evidence.find((row) => row.pageTitle);
  const destinations = [...new Set(evidence.map((row) => row.urlTo))];

  return {
    score,
    recommendation,
    factors,
    confidence:
      evidence.length > 0 && rank !== null
        ? "high"
        : rank !== null
          ? "medium"
          : "low",
    limitations,
    whyFound: `${candidate.referringDomain} links to ${candidate.competitorCount} of ${input.comparedCompetitors} compared competitors (${names}) and has no link to you in this read.`,
    whyRelevant: titled
      ? `Linking page: "${titled.pageTitle}". Judge whether it fits your topic; this is not scored.`
      : "Relevance is not assessed until a linking page is read.",
    whyRealistic: factors
      .filter((f) => f.factor === "Link attributes" || f.factor === "Effort")
      .map((f) => f.detail)
      .join(" "),
    nextAction: belowMinimum
      ? `Skip: linked from fewer than ${settings.minCompetitors} competitors.`
      : evidence.length === 0
        ? "Read the linking pages to see what the competitors were linked for."
        : recommendation === "pursue"
          ? "Match a page on your site, then draft outreach."
          : recommendation === "review"
            ? "Review the linking pages before deciding."
            : "Skip, or save it with a note if you know the site.",
    competitorDestinations: destinations,
    attributes,
  };
}
