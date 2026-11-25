import { z } from "zod";
import {
  AI_PROMPT_INTENTS,
  AI_UNKNOWN_INTENT,
} from "@/shared/ai-prompt-intent";
import { aiEngineSchema, aiMarketSchema } from "./ai-visibility";

const domainSchema = z.string().trim().min(1).max(253);

export const aiIntelligenceSchema = aiMarketSchema.extend({
  days: z.union([z.literal(7), z.literal(28), z.literal(90)]).default(28),
  // Omit for the prompt set of the newest run in the window.
  promptSetVersionId: z.string().min(1).max(100).nullish(),
  engines: z.array(aiEngineSchema).max(aiEngineSchema.options.length).nullish(),
  topic: z.string().trim().min(1).max(100).nullish(),
  branded: z.enum(["all", "branded", "unbranded"]).default("all"),
  // Omit for every intent; "unknown" selects prompts with no intent set.
  intents: z
    .array(z.enum([...AI_PROMPT_INTENTS, AI_UNKNOWN_INTENT]))
    .max(AI_PROMPT_INTENTS.length + 1)
    .nullish(),
  // Omit for every tracked competitor; your own brand is always compared.
  competitors: z.array(domainSchema).max(50).nullish(),
  // The brand whose prompt-level evidence is listed; omit for your own.
  brand: domainSchema.nullish(),
});

export type AiIntelligenceInput = z.infer<typeof aiIntelligenceSchema>;

export const aiEvidencePageSchema = aiIntelligenceSchema.extend({
  cursor: z
    .object({
      topic: z.string().max(100),
      prompt: z.string().max(2000),
      promptId: z.string().min(1).max(100),
    })
    .nullish(),
  // Prompt ids of a page are bound in one statement, under D1's bind limit.
  limit: z.number().int().min(1).max(50).default(20),
});

export type AiEvidencePageInput = z.infer<typeof aiEvidencePageSchema>;
