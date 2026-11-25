import { z } from "zod";
import { aiEngineSchema, aiMarketSchema } from "./ai-visibility";

export const citationGapSchema = aiMarketSchema.extend({
  days: z.union([z.literal(7), z.literal(28), z.literal(90)]).default(28),
  engines: z.array(aiEngineSchema).max(aiEngineSchema.options.length).nullish(),
  topic: z.string().trim().min(1).max(100).nullish(),
});
export type CitationGapInput = z.infer<typeof citationGapSchema>;

export const citationSourceSchema = citationGapSchema.extend({
  domain: z.string().trim().min(1).max(253),
});
export type CitationSourceInput = z.infer<typeof citationSourceSchema>;

// The finding is looked up again on the server from stored answers; the client
// only names which one.
export const createGapOpportunitySchema = citationGapSchema.extend({
  findingKey: z.string().min(1).max(600),
});
export type CreateGapOpportunityInput = z.infer<
  typeof createGapOpportunitySchema
>;
