import { z } from "zod";
import {
  LINK_CAMPAIGN_MODES,
  LINK_DISCOVERY_METHODS,
  LINK_GAP_MAX_COMPETITORS,
  LINK_PROSPECT_STATUSES,
  LINK_RECOMMENDATIONS,
} from "@/shared/link-acquisition";

// Shared by the server functions, the MCP tools and the tables, so the page
// and an agent filter and run the same way.

export const LINK_GAP_ROW_LIMITS = [50, 100, 200, 300] as const;

export const linkGapRunInputSchema = z.object({
  // Saved competitors when empty.
  competitors: z
    .array(z.string().trim().min(1).max(253))
    .max(LINK_GAP_MAX_COMPETITORS)
    .default([]),
  mode: z.enum(["partial", "all"]).default("partial"),
  includeSingle: z.boolean().default(false),
  linkStatus: z.enum(["live", "lost"]).default("live"),
  includeSubdomains: z.boolean().default(true),
  rowLimit: z
    .number()
    .int()
    .refine((value) =>
      (LINK_GAP_ROW_LIMITS as readonly number[]).includes(value),
    )
    .default(100),
});
export type LinkGapRunInput = z.infer<typeof linkGapRunInputSchema>;

export const LINK_GAP_SORT_FIELDS = [
  "score",
  "competitorCount",
  "domainRank",
  "spamScore",
  "firstSeen",
  "referringDomain",
] as const;

export const linkGapQuerySchema = z.object({
  // Latest run when omitted.
  runId: z.string().min(1).optional(),
  search: z.string().trim().max(100).optional(),
  minCompetitors: z
    .number()
    .int()
    .min(1)
    .max(LINK_GAP_MAX_COMPETITORS)
    .optional(),
  recommendation: z.enum(LINK_RECOMMENDATIONS).optional(),
  competitor: z.string().trim().max(253).optional(),
  maxSpamScore: z.number().int().min(0).max(100).optional(),
  minDomainRank: z.number().int().min(0).max(1000).optional(),
  hasEvidence: z.boolean().optional(),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(10).max(200).default(50),
  sortBy: z.enum(LINK_GAP_SORT_FIELDS).default("score"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});
export type LinkGapQuery = z.infer<typeof linkGapQuerySchema>;

export const linkEvidenceInputSchema = z.object({
  runId: z.string().min(1),
  domains: z.array(z.string().trim().min(1).max(253)).min(1).max(10),
});

export const linkRecoveryInputSchema = z.object({
  kind: z.enum(["lost", "broken"]),
});

export const linkMentionInputSchema = z.object({
  urls: z.array(z.string().trim().min(1).max(2000)).min(1).max(20),
  extraTerms: z.array(z.string().trim().min(3).max(80)).max(5).optional(),
});

export const qualificationSettingsSchema = z.object({
  minCompetitors: z.number().int().min(1).max(LINK_GAP_MAX_COMPETITORS),
  preferredLanguage: z.string().trim().toLowerCase().max(12).nullable(),
  softMaxSpamScore: z.number().int().min(0).max(100),
  softMinDomainRank: z.number().int().min(0).max(1000),
  weightCompetitors: z.number().int().min(0).max(100),
  weightAuthority: z.number().int().min(0).max(100),
  weightContext: z.number().int().min(0).max(100),
  weightFollow: z.number().int().min(0).max(100),
  weightPersistence: z.number().int().min(0).max(100),
  weightEffort: z.number().int().min(0).max(100),
  pursueAt: z.number().int().min(0).max(100),
  skipBelow: z.number().int().min(0).max(100),
});

const prospectStatusSchema = z.enum(LINK_PROSPECT_STATUSES);

const campaignModeSchema = z.enum(LINK_CAMPAIGN_MODES);

export const prospectListQuerySchema = z.object({
  status: prospectStatusSchema.optional(),
  method: z.enum(LINK_DISCOVERY_METHODS).optional(),
  campaignMode: campaignModeSchema.optional(),
  recommendation: z.enum(LINK_RECOMMENDATIONS).optional(),
  // A user id, or "none" for unassigned.
  assigneeUserId: z.string().min(1).max(100).optional(),
  dueBefore: z.string().date().optional(),
  search: z.string().trim().max(100).optional(),
  sortBy: z
    .enum(["updatedAt", "score", "dueDate", "referringDomain"])
    .default("updatedAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(10).max(200).default(50),
});
export type ProspectListQuery = z.infer<typeof prospectListQuerySchema>;

export const prospectPatchSchema = z
  .object({
    status: prospectStatusSchema,
    campaignMode: campaignModeSchema,
    assigneeUserId: z.string().min(1).max(100).nullable(),
    dueDate: z.string().date().nullable(),
    notes: z.string().trim().max(2000).nullable(),
    targetUrl: z.string().trim().url().max(2048).nullable(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, "Nothing to change.");
export type ProspectPatch = z.infer<typeof prospectPatchSchema>;

const ids = z.array(z.string().min(1)).min(1).max(100);

export const saveFromGapInputSchema = z.object({
  runId: z.string().min(1),
  domains: z.array(z.string().min(1).max(253)).min(1).max(100),
  campaignMode: campaignModeSchema.default("earned_editorial"),
});

export const saveManualInputSchema = z.object({
  domainOrUrl: z.string().trim().min(1).max(2048),
  pageUrl: z.string().trim().url().max(2048).nullish(),
  campaignMode: campaignModeSchema.default("earned_editorial"),
  notes: z.string().trim().max(2000).nullish(),
});

export const saveFromAiInputSchema = z.object({
  domains: z.array(z.string().min(1).max(253)).min(1).max(100),
  campaignMode: campaignModeSchema.default("earned_editorial"),
});

export const prospectUpdateInputSchema = z.object({
  ids,
  patch: prospectPatchSchema,
  note: z.string().trim().max(500).nullish(),
});

export const prospectIdsSchema = z.object({ ids });

export const assetOpportunityInputSchema = z.object({
  prospectId: z.string().min(1),
  withBrief: z.boolean().default(false),
});

export const outreachGenerateInputSchema = z.object({
  prospectId: z.string().min(1),
  contactName: z.string().trim().max(200).nullish(),
  contactEmail: z.string().trim().max(320).nullish(),
});

export const outreachEditInputSchema = z.object({
  draftId: z.string().min(1),
  subject: z.string().trim().min(1).max(300).optional(),
  body: z.string().trim().min(1).max(10_000).optional(),
  contactName: z.string().trim().max(200).nullish(),
  contactEmail: z.string().trim().max(320).nullish(),
});

export const draftIdSchema = z.object({ draftId: z.string().min(1) });

export const outreachReplyInputSchema = z.object({
  draftId: z.string().min(1),
  outcome: z.enum(["responded", "declined", "unsubscribed"]),
  note: z.string().trim().max(1000).nullish(),
});

export const suppressionInputSchema = z.object({
  value: z.string().trim().min(1).max(320),
});

export const placementCreateInputSchema = z.object({
  urlFrom: z.string().trim().url().max(2048),
  expectedTarget: z.string().trim().url().max(2048),
  campaignMode: campaignModeSchema.default("earned_editorial"),
  prospectId: z.string().min(1).nullish(),
  state: z.enum(["promised", "observed"]).default("promised"),
  costUsd: z.number().min(0).max(1_000_000).nullish(),
});

export const placementIdSchema = z.object({ placementId: z.string().min(1) });
