import { z } from "zod";
import { RANGE_KEYS } from "@/shared/attribution/ranges";
import { enquiryDetailsSchema } from "@/shared/attribution/enquiry";
import {
  CHANNELS,
  EVENT_TYPES,
  MODEL_KEYS,
} from "@/shared/attribution/vocabulary";

const id = z.string().trim().min(1).max(200);
const optionalId = id.optional();
const url = z.string().trim().max(2048).optional();
const minor = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);

/**
 * What the tracker snippet in a visitor's browser sends. The other types stay
 * listed so a stale install gets a per-event rejection, not a refused batch.
 * User and lead ids are not read from a browser at all.
 */
export const browserEventSchema = z.object({
  id: id,
  type: z.enum([
    "page_view",
    "session_start",
    "identify",
    "signup",
    "lead",
    "booking",
  ]),
  // Milliseconds since the epoch, from the visitor's clock.
  t: z.number().int().optional(),
  vid: id,
  sid: optionalId,
  url,
  ref: url,
  test: z.boolean().optional(),
  v: z.number().int().optional(),
});
export type BrowserEvent = z.infer<typeof browserEventSchema>;

export const browserBatchSchema = z.object({
  k: z.string().min(10).max(120),
  events: z.array(browserEventSchema).min(1).max(20),
});

const serverIdentifiers = {
  visitor_id: optionalId,
  user_id: optionalId,
  customer_id: optionalId,
  contact_id: optionalId,
  lead_id: optionalId,
  order_id: optionalId,
  account_id: optionalId,
  deal_id: optionalId,
};

/** An authoritative event from the customer's own backend. */
export const serverEventSchema = z.object({
  event_id: optionalId,
  type: z.enum(EVENT_TYPES).exclude(["session_start", "page_view"]),
  occurred_at: z.iso.datetime({ offset: true }).optional(),
  ...serverIdentifiers,
  property: z.string().trim().max(200).optional(),
  brand: z.string().trim().max(120).optional(),
  intended_brand: z.string().trim().max(120).optional(),
  url,
  referrer: url,
  // Set when the source system records them without a landing url, as a call tracker does.
  utm_source: z.string().trim().max(200).optional(),
  utm_medium: z.string().trim().max(200).optional(),
  utm_campaign: z.string().trim().max(200).optional(),
  session_id: optionalId,
  self_reported_source: z.string().trim().max(500).optional(),
  stage: z.string().trim().max(80).optional(),
  amount_minor: minor.optional(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((c) => c.toUpperCase())
    .optional(),
  parent_event_id: optionalId,
  ...enquiryDetailsSchema.shape,
  test: z.boolean().optional(),
});
export type ServerEvent = z.infer<typeof serverEventSchema>;

export const serverBatchSchema = z.object({
  events: z.array(serverEventSchema).min(1).max(100),
});

export const attributionProjectSchema = z.object({
  projectId: z.string().min(1).describe("The project."),
});

export const attributionPropertySchema = attributionProjectSchema.extend({
  name: z.string().trim().min(1).max(100),
  host: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(200)
    .regex(/^[a-z0-9.-]+$/, "A host like example.com, with no path"),
  brandId: z.string().optional(),
});

export const attributionBrandSchema = attributionProjectSchema.extend({
  name: z.string().trim().min(1).max(120),
});

export const attributionSourceRuleSchema = attributionProjectSchema.extend({
  matchKind: z.enum(["referrer_host", "utm_source", "utm_medium", "click_id"]),
  pattern: z.string().trim().toLowerCase().min(1).max(200),
  channel: z.enum(CHANNELS),
  sourceLabel: z.string().trim().min(1).max(120),
});

export const attributionKeyKindSchema = attributionProjectSchema.extend({
  kind: z.enum(["public", "secret"]),
});

export const attributionSettingsSchema = attributionProjectSchema.extend({
  consentMode: z.enum(["required", "implied"]),
  timezone: z.string().min(1).max(64),
  reportingCurrency: z
    .string()
    .length(3)
    .transform((c) => c.toUpperCase()),
  lookbackDays: z.number().int().min(1).max(365),
  retentionDays: z.number().int().min(30).max(1825),
  defaultModel: z.enum([
    "first_touch",
    "last_touch",
    "last_non_direct",
    "linear",
    "position_based",
    "time_decay",
    "self_reported",
  ]),
});

export const attributionIdSchema = attributionProjectSchema.extend({
  id: z.string().min(1),
});

export const attributionReportSchema = attributionProjectSchema.extend({
  model: z.enum(MODEL_KEYS).optional(),
  range: z.enum(RANGE_KEYS).default("28d"),
  demo: z.boolean().default(false),
  brandId: z.string().optional(),
});

export const attributionJourneysSchema = attributionReportSchema.extend({
  kinds: z.array(z.string().max(40)).max(10).optional(),
  before: z.string().max(40).optional(),
});

export const attributionCompareSchema = attributionReportSchema.extend({
  kind: z.string().min(1).max(40),
});

export const attributionLandingSchema = attributionReportSchema.extend({
  onlyCommercial: z.boolean().optional(),
});

export const attributionPageSchema = attributionReportSchema.extend({
  host: z.string().trim().toLowerCase().min(1).max(253),
  path: z.string().trim().min(1).max(2048).startsWith("/"),
});

export const attributionFindingSchema = attributionReportSchema.extend({
  key: z.string().trim().min(1).max(2400),
});

export const attributionConversionSchema = attributionProjectSchema.extend({
  conversionId: z.string().min(1).max(100),
});

export const attributionDemoSchema = attributionProjectSchema.extend({
  demo: z.boolean(),
});

export const attributionPaymentConnectorSchema =
  attributionProjectSchema.extend({
    kind: z.enum(["stripe", "polar"]),
    label: z.string().trim().min(1).max(80),
    signingSecret: z.string().trim().min(10).max(200),
  });

export const posthogCredentialsSchema = z.object({
  region: z.enum(["us", "eu"]),
  posthogProjectId: z
    .string()
    .regex(/^\d{1,12}$/, "A PostHog project id is a number"),
  apiKey: z
    .string()
    .regex(
      /^phx_[A-Za-z0-9]{20,}$/,
      "A PostHog personal API key starts with phx_",
    ),
});

export const attributionCsvSchema = attributionProjectSchema.extend({
  label: z.string().trim().min(1).max(80),
  text: z.string().min(1).max(1_100_000),
  dryRun: z.boolean(),
});

const ATTRIBUTION_VIEWS = [
  "overview",
  "journeys",
  "search",
  "leads",
  "health",
] as const;

export const attributionPageSearchSchema = z.object({
  view: z.enum(ATTRIBUTION_VIEWS).optional().catch(undefined),
  range: z.enum(RANGE_KEYS).optional().catch(undefined),
  model: z.enum(MODEL_KEYS).optional().catch(undefined),
  demo: z.boolean().optional().catch(undefined),
  brand: z.string().max(100).optional().catch(undefined),
  conversion: z.string().max(100).optional().catch(undefined),
  // A landing page as host followed by its path, for the Search & AI detail.
  page: z.string().max(2400).optional().catch(undefined),
});
export type AttributionPageSearch = z.infer<typeof attributionPageSearchSchema>;
