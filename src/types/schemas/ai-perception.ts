import { z } from "zod";
import {
  PERCEPTION_SENTIMENTS,
  PERCEPTION_STANCES,
} from "@/shared/ai-perception";
import { EXPERIMENT_LIMITS } from "@/shared/ai-perception-experiments";
import { aiProjectSchema } from "./ai-visibility";
import { aiIntelligenceSchema } from "./ai-visibility-intelligence";

export const getAiPerceptionSchema = aiProjectSchema.extend({
  runId: z
    .string()
    .uuid()
    .optional()
    .describe("Defaults to the newest finished run."),
  brand: z
    .enum(["own", "competitors", "all"])
    .default("own")
    .describe("Whose readings to list. Defaults to your own brand."),
  stance: z.enum(PERCEPTION_STANCES).optional(),
  sentiment: z.enum(PERCEPTION_SENTIMENTS).optional(),
  limit: z.number().int().min(1).max(100).default(30),
});

export const reviewAiPerceptionSchema = aiProjectSchema.extend({
  perceptionId: z.string().uuid(),
  stance: z.enum(PERCEPTION_STANCES).optional(),
  sentiment: z.enum(PERCEPTION_SENTIMENTS).optional(),
  note: z
    .string()
    .trim()
    .max(300)
    .optional()
    .describe("Why the saved reading is wrong. Kept with the correction."),
});

export const aiPerceptionExportSchema = aiIntelligenceSchema.extend({
  domain: z.string().trim().min(1).max(253),
});

export const aiPerceptionCellSchema = aiPerceptionExportSchema.extend({
  promptId: z.string().min(1).max(100).nullish(),
  topic: z.string().trim().min(1).max(100).nullish(),
});

export const aiPerceptionSourceEvidenceSchema = aiIntelligenceSchema.extend({
  domain: z.string().trim().min(1).max(253),
  sourceDomain: z.string().trim().min(1).max(253),
});

export const saveAiPerceptionOpportunitySchema = aiIntelligenceSchema.extend({
  opportunityId: z.string().min(1).max(300),
});

const aiPerceptionExperimentFieldsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  sourceUrl: z.string().trim().url().max(2000).nullish(),
  originalText: z.string().trim().min(1).max(20_000),
  editedText: z.string().trim().min(1).max(20_000),
  assumptions: z.string().trim().max(1000).default(""),
  repeats: z
    .number()
    .int()
    .min(1)
    .max(EXPERIMENT_LIMITS.repeats)
    .default(EXPERIMENT_LIMITS.minRepeatsForVerdict),
  promptIds: z
    .array(z.string().min(1).max(100))
    .min(1)
    .max(EXPERIMENT_LIMITS.prompts),
});

const createAiPerceptionExperimentSchema = aiProjectSchema.extend(
  aiPerceptionExperimentFieldsSchema.shape,
);

export const updateAiPerceptionExperimentSchema =
  createAiPerceptionExperimentSchema.extend({
    experimentId: z.string().uuid(),
  });

export const aiPerceptionExperimentIdSchema = aiProjectSchema.extend({
  experimentId: z.string().uuid(),
});

export const loadAiPerceptionExperimentPageSchema = aiProjectSchema.extend({
  url: z.string().trim().url().max(2000),
});

export const saveAiPerceptionExperimentToolSchema =
  createAiPerceptionExperimentSchema.extend({
    experimentId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Omit to create an experiment. Pass an existing id to replace its text, prompts or repeats; that clears its replay.",
      ),
  });

export const replayAiPerceptionExperimentToolSchema =
  aiPerceptionExperimentIdSchema.extend({
    maxCostUsd: z
      .number()
      .positive()
      .max(5)
      .describe(
        "The most you accept spending. The replay is refused when its upper estimate is higher; read get_ai_perception_experiment for the estimate first.",
      ),
  });
