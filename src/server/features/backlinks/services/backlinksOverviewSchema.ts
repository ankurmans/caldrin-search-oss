import { z } from "zod";

const backlinksRowSchema = z.object({
  domainFrom: z.string().nullable(),
  urlFrom: z.string().nullable(),
  urlTo: z.string().nullable(),
  anchor: z.string().nullable(),
  itemType: z.string().nullable(),
  isDofollow: z.boolean().nullable(),
  relAttributes: z.array(z.string()),
  rank: z.number().nullable(),
  domainFromRank: z.number().nullable(),
  pageFromRank: z.number().nullable(),
  spamScore: z.number().nullable(),
  firstSeen: z.string().nullable(),
  lastSeen: z.string().nullable(),
  isLost: z.boolean(),
  isBroken: z.boolean(),
  linksCount: z.number().nullable(),
  // Evidence recorded by the provider for the linking page and the link. Rows
  // cached before these fields existed read as null, never as a guess.
  lostDate: z.string().nullable().default(null),
  prevSeen: z.string().nullable().default(null),
  isNew: z.boolean().nullable().default(null),
  pageTitle: z.string().nullable().default(null),
  pageLanguage: z.string().nullable().default(null),
  pageStatusCode: z.number().nullable().default(null),
  platformTypes: z.array(z.string()).default([]),
  domainCountry: z.string().nullable().default(null),
  textBefore: z.string().nullable().default(null),
  textAfter: z.string().nullable().default(null),
  semanticLocation: z.string().nullable().default(null),
  targetStatusCode: z.number().nullable().default(null),
  targetRedirect: z.string().nullable().default(null),
});

const anchorRowSchema = z.object({
  anchor: z.string().nullable(),
  backlinks: z.number().nullable(),
  referringDomains: z.number().nullable(),
  referringPages: z.number().nullable(),
  nofollowDomains: z.number().nullable(),
  rank: z.number().nullable(),
  spamScore: z.number().nullable(),
  firstSeen: z.string().nullable(),
  // Counts of links by rel attribute, as the provider reports them.
  attributes: z.record(z.string(), z.number()),
});

const referringDomainRowSchema = z.object({
  domain: z.string().nullable(),
  backlinks: z.number().nullable(),
  referringPages: z.number().nullable(),
  rank: z.number().nullable(),
  spamScore: z.number().nullable(),
  firstSeen: z.string().nullable(),
  brokenBacklinks: z.number().nullable(),
  brokenPages: z.number().nullable(),
});

const topPageRowSchema = z.object({
  page: z.string().nullable(),
  backlinks: z.number().nullable(),
  referringDomains: z.number().nullable(),
  rank: z.number().nullable(),
  brokenBacklinks: z.number().nullable(),
});

const backlinksTrendRowSchema = z.object({
  date: z.string(),
  backlinks: z.number().nullable(),
  referringDomains: z.number().nullable(),
  rank: z.number().nullable(),
});

const backlinksNewLostTrendRowSchema = z.object({
  date: z.string(),
  newBacklinks: z.number().nullable(),
  lostBacklinks: z.number().nullable(),
  newReferringDomains: z.number().nullable(),
  lostReferringDomains: z.number().nullable(),
});

export const backlinksOverviewSchema = z.object({
  target: z.string(),
  displayTarget: z.string(),
  scope: z.enum(["exact_url", "subfolder", "domain", "subdomains"]),
  summary: z.object({
    rank: z.number().nullable(),
    backlinks: z.number().nullable(),
    referringPages: z.number().nullable(),
    referringDomains: z.number().nullable(),
    brokenBacklinks: z.number().nullable(),
    brokenPages: z.number().nullable(),
    backlinksSpamScore: z.number().nullable(),
    targetSpamScore: z.number().nullable(),
    newBacklinks: z.number().nullable(),
    lostBacklinks: z.number().nullable(),
    newReferringDomains: z.number().nullable(),
    lostReferringDomains: z.number().nullable(),
    // Links carrying rel="nofollow" / "ugc" / "sponsored", and the referring
    // domains that only link that way. Null where the provider reports none.
    nofollowBacklinks: z.number().nullable().default(null),
    ugcBacklinks: z.number().nullable().default(null),
    sponsoredBacklinks: z.number().nullable().default(null),
    nofollowReferringDomains: z.number().nullable().default(null),
  }),
  trends: z.array(backlinksTrendRowSchema),
  // When the domain was last registered. History before it belongs to an
  // earlier owner or to lists that only name the domain.
  registeredAt: z.string().nullable().default(null),
  newLostTrends: z.array(backlinksNewLostTrendRowSchema),
  fetchedAt: z.string(),
});

export type BacklinksOverviewResult = z.infer<typeof backlinksOverviewSchema>;

function buildPageResultSchema<T extends z.ZodTypeAny>(rowSchema: T) {
  return z.object({
    rows: z.array(rowSchema),
    totalCount: z.number().nullable(),
    hasMore: z.boolean(),
    page: z.number(),
    pageSize: z.number(),
    fetchedAt: z.string(),
  });
}

export const backlinksRowsPageResultSchema =
  buildPageResultSchema(backlinksRowSchema);
export const referringDomainsPageResultSchema = buildPageResultSchema(
  referringDomainRowSchema,
);
export const topPagesPageResultSchema = buildPageResultSchema(topPageRowSchema);
export const anchorsPageResultSchema = buildPageResultSchema(anchorRowSchema);

export type BacklinksRowsPageResult = z.infer<
  typeof backlinksRowsPageResultSchema
>;
export type ReferringDomainsPageResult = z.infer<
  typeof referringDomainsPageResultSchema
>;
export type TopPagesPageResult = z.infer<typeof topPagesPageResultSchema>;
export type AnchorsPageResult = z.infer<typeof anchorsPageResultSchema>;
