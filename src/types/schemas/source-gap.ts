import { z } from "zod";
import { aiProjectSchema } from "./ai-visibility";

export const sourceGapPromptSchema = aiProjectSchema.extend({
  promptId: z.string().min(1).max(100),
});
export type SourceGapPromptInput = z.infer<typeof sourceGapPromptSchema>;

export const sourceGapAnalyzeSchema = sourceGapPromptSchema.extend({
  // Read cited and owner pages again even if a recent copy is stored.
  forceRefresh: z.boolean().default(false),
  // Read this one page of the site again; nothing else is fetched afresh.
  retryUrl: z.string().url().max(2000).optional(),
});
export type SourceGapAnalyzeInput = z.infer<typeof sourceGapAnalyzeSchema>;

export const sourceGapOwnerSchema = sourceGapPromptSchema.extend({
  // Null goes back to the page Caldrin picks.
  ownerUrl: z.string().url().max(2000).nullable(),
});

export const sourceGapOpportunitySchema = aiProjectSchema.extend({
  analysisId: z.string().min(1).max(100),
});
