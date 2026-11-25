import { z } from "zod";
import { aiProjectSchema } from "./ai-visibility";

export const crawlerEventSchema = z.object({
  userAgent: z.string().max(500),
  path: z.string().max(2048),
  status: z.number().int().min(100).max(599),
});
export type CrawlerEvent = z.infer<typeof crawlerEventSchema>;

export const crawlerActivitySchema = aiProjectSchema.extend({
  days: z
    .union([z.literal(7), z.literal(28), z.literal(90)])
    .default(28)
    .describe("Days of visits to read."),
});
export type CrawlerActivityInput = z.infer<typeof crawlerActivitySchema>;

export const crawlerCloudflareSchema = aiProjectSchema.extend({
  // Left out to reuse the token another project in the workspace connected.
  token: z.string().trim().min(20).max(200).optional(),
});
