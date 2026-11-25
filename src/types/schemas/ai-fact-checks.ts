import { z } from "zod";
import { aiProjectSchema, getAiRunSchema } from "./ai-visibility";

export const MAX_BRAND_FACTS = 20;

export const addBrandFactSchema = aiProjectSchema.extend({
  statement: z
    .string()
    .trim()
    .min(8)
    .max(300)
    .describe(
      "One plain statement that is true about the brand, such as 'The company offers a free trial.'",
    ),
});

export const removeBrandFactSchema = aiProjectSchema.extend({
  factId: z.string().uuid(),
});

export const checkBrandFactsSchema = getAiRunSchema;

export const factCheckReportSchema = aiProjectSchema.extend({
  runId: z
    .string()
    .uuid()
    .optional()
    .describe("Defaults to the newest finished run."),
});
