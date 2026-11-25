import { z } from "zod";

const countSchema = z.object({
  numerator: z.number(),
  denominator: z.number(),
});

const sideSchema = z.object({
  /** Collection day (YYYY-MM-DD) or ISO week (YYYY-Www). */
  period: z.string(),
  window: z.object({ start: z.string(), end: z.string() }).nullable(),
  runs: z.number(),
  answered: z.number(),
});

/** The conditions both sides were measured under; stated on every alert. */
const conditionsSchema = z.object({
  promptSetVersionIds: z.array(z.string().nullable()),
  promptSetVersion: z.number().nullable(),
  engines: z.array(z.string()),
  markets: z.array(z.string()),
  before: sideSchema.nullable(),
  after: sideSchema,
  reliability: z.string(),
});

const metricSchema = z.object({
  metric: z.string(),
  subject: z.string(),
  before: countSchema.nullable(),
  after: countSchema,
  difference: z.number().nullable(),
  verdict: z.string().nullable(),
});

/** What `project_alerts.details_json` holds. Parsed on read: it is stored text. */
export const alertDetailsSchema = z.object({
  conditions: conditionsSchema.nullable(),
  metrics: z.array(metricSchema),
  attributionNote: z.string().nullable(),
  job: z.string().optional(),
});

export type AlertDetails = z.infer<typeof alertDetailsSchema>;
export type AlertConditions = z.infer<typeof conditionsSchema>;
export type AlertMetric = z.infer<typeof metricSchema>;
