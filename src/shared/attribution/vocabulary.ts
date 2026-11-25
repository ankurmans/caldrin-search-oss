// The words the attribution ledger uses. Shared by the server, the tracker
// snippet, the dashboards and the MCP tools so they never drift.

export const EVENT_TYPES = [
  "page_view",
  "identify",
  "session_start",
  "signup",
  "activation",
  "lead",
  "qualified_lead",
  "call",
  "booking",
  "deal_won",
  "deal_lost",
  "payment",
  "refund",
  "subscription_started",
  "subscription_changed",
  "subscription_canceled",
  "custom",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Event types that become an outcome the attribution models credit. */
const CONVERSION_TYPES: readonly EventType[] = [
  "signup",
  "activation",
  "lead",
  "qualified_lead",
  "call",
  "booking",
  "deal_won",
  "payment",
];

export const ORIGINS = ["browser", "server", "webhook", "import"] as const;
export type Origin = (typeof ORIGINS)[number];

/** The identities an event can carry. Anything not listed is never joined on. */
export const IDENTIFIER_TYPES = [
  "visitor",
  "user",
  "contact",
  "customer",
  "lead",
  "order",
  "account",
  "deal",
] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];

/** Why two identities were joined: always an id the source system itself supplied. */
export const LINK_BASIS = {
  user_visitor: "An app user id sent together with the browser visitor id",
  user_customer: "A billing customer id sent together with an app user id",
  user_lead: "A form or lead id sent together with an app user id",
  visitor_lead:
    "A form submission id sent together with the browser visitor id",
  visitor_order: "An order id sent together with the browser visitor id",
  customer_order: "An order id sent together with a billing customer id",
  contact_lead: "A CRM contact id sent together with a lead id",
  contact_deal: "A CRM deal id sent together with a verified contact id",
  account_user: "An account id sent together with an app user id",
  other: "Two ids sent together on one source event",
} as const;

/** An identity type that can only have one value in a subject. */
export const SINGLE_VALUED: ReadonlySet<IdentifierType> = new Set([
  "user",
  "contact",
  "account",
]);

export const CHANNELS = [
  "organic_search",
  "ai_referral",
  "paid",
  "social",
  "email",
  "referral",
  "outbound",
  "direct",
  "internal",
  "search_unspecified",
  "unknown",
] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  organic_search: "Organic search",
  ai_referral: "AI assistants",
  paid: "Paid",
  social: "Social",
  email: "Email",
  referral: "Other referrals",
  outbound: "Outbound",
  direct: "Direct",
  internal: "Own site",
  search_unspecified: "Search (type not specified)",
  unknown: "Unknown source",
};

export const EVIDENCE_LEVELS = [
  "observed",
  "linked",
  "self_reported",
  "associated",
  "modelled",
  "unknown",
] as const;
export type Evidence = (typeof EVIDENCE_LEVELS)[number];

export const EVIDENCE_LABELS: Record<Evidence, string> = {
  observed: "Observed",
  linked: "Linked",
  self_reported: "Self-reported",
  associated: "Associated",
  modelled: "Modelled",
  unknown: "Unknown",
};

export const EVIDENCE_EXPLANATIONS: Record<Evidence, string> = {
  observed: "A source system recorded this directly on the outcome itself.",
  linked:
    "Two observed events joined by an identifier the source supplied (a user id, a customer id, a form id).",
  self_reported: "The buyer told us how they found you.",
  associated:
    "The outcome belongs to a page associated with a topic. It is not the query that was typed.",
  modelled:
    "An algorithm shared the credit across known touchpoints. It is not an observation.",
  unknown:
    "No source was recorded. It is kept as unknown, not given to a channel.",
};

export const MODEL_KEYS = [
  "first_touch",
  "last_touch",
  "last_non_direct",
  "linear",
  "position_based",
  "time_decay",
  "self_reported",
] as const;
export type ModelKey = (typeof MODEL_KEYS)[number];

export const MODEL_LABELS: Record<ModelKey, string> = {
  first_touch: "First touch",
  last_touch: "Last touch",
  last_non_direct: "Last non-direct",
  linear: "Linear",
  position_based: "Position-based",
  time_decay: "Time decay",
  self_reported: "Self-reported",
};

export const MODEL_DESCRIPTIONS: Record<ModelKey, string> = {
  first_touch: "All credit to the first recorded source.",
  last_touch: "All credit to the last recorded source before the outcome.",
  last_non_direct:
    "All credit to the last source that was not direct; direct only if nothing else was recorded.",
  linear: "Equal credit to every recorded source.",
  position_based:
    "40% to the first source, 40% to the last, 20% shared across the middle.",
  time_decay: "More credit to sources closer to the outcome (7-day half-life).",
  self_reported: "The source the buyer said brought them, where they said one.",
};

/** Bumped whenever a model's arithmetic or a built-in rule changes. */
export const MODEL_VERSION = "1";

/** The member of `list` equal to `value`, or null: narrows a stored string without a cast. */
export function narrow<const T extends readonly string[]>(
  list: T,
  value: string | null | undefined,
): T[number] | null {
  return list.find((item) => item === value) ?? null;
}

export const isConversionType = (value: string) =>
  CONVERSION_TYPES.some((type) => type === value);
