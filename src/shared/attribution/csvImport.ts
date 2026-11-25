import Papa from "papaparse";
import {
  serverEventSchema,
  type ServerEvent,
} from "@/types/schemas/attribution";
import { toMinorUnits } from "./money";

const CSV_MAX_ROWS = 5000;
export const CSV_MAX_BYTES = 1_000_000;

type CsvRowError = { row: number; message: string };

// Column names a file may use, mapped to the event field they fill.
const ALIASES: Record<string, string> = {
  type: "type",
  event_type: "type",
  event: "type",
  date: "occurred_at",
  occurred_at: "occurred_at",
  created_at: "occurred_at",
  timestamp: "occurred_at",
  id: "event_id",
  event_id: "event_id",
  amount: "amount",
  amount_minor: "amount_minor",
  currency: "currency",
  visitor_id: "visitor_id",
  user_id: "user_id",
  customer_id: "customer_id",
  contact_id: "contact_id",
  lead_id: "lead_id",
  order_id: "order_id",
  account_id: "account_id",
  deal_id: "deal_id",
  parent_id: "parent_event_id",
  parent_event_id: "parent_event_id",
  source: "self_reported_source",
  self_reported_source: "self_reported_source",
  how_did_you_hear: "self_reported_source",
  url: "url",
  landing_url: "url",
  referrer: "referrer",
  brand: "brand",
  intended_brand: "intended_brand",
  service_brand: "intended_brand",
  channel: "enquiry_channel",
  enquiry_channel: "enquiry_channel",
  call_status: "call_status",
  duration_seconds: "duration_seconds",
  duration: "duration_seconds",
  handoff: "handoff",
  lead_owner: "lead_owner",
  deal_owner: "deal_owner",
  property: "property",
  stage: "stage",
};

const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function normalizeDate(value: string) {
  const trimmed = value.trim();
  if (!ISO_DATE.test(trimmed)) return null;
  // A date with no zone is read as UTC, so the same file means the same thing everywhere.
  const withZone = /(Z|[+-]\d{2}:?\d{2})$/.test(trimmed)
    ? trimmed
    : `${trimmed.replace(" ", "T")}${trimmed.length === 10 ? "T00:00:00" : ""}Z`;
  const time = Date.parse(withZone);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function toEvent(raw: Record<string, string>): {
  event?: ServerEvent;
  error?: string;
} {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const target =
      ALIASES[
        key
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, "_")
      ];
    const text = value?.trim();
    if (target && text) fields[target] = text;
  }
  if (typeof fields.occurred_at === "string") {
    const iso = normalizeDate(fields.occurred_at);
    if (!iso)
      return {
        error: "Use an ISO date such as 2026-11-03 or 2026-11-03T14:30:00Z",
      };
    fields.occurred_at = iso;
  }
  const currency =
    typeof fields.currency === "string"
      ? fields.currency.toUpperCase()
      : undefined;
  if (typeof fields.amount === "string") {
    if (!currency) return { error: "An amount needs a currency" };
    const minor = toMinorUnits(fields.amount, currency);
    if (minor === null) return { error: `"${fields.amount}" is not an amount` };
    fields.amount_minor = minor;
  } else if (typeof fields.amount_minor === "string") {
    const minor = Number(fields.amount_minor);
    if (!Number.isInteger(minor))
      return { error: "amount_minor must be a whole number" };
    fields.amount_minor = minor;
  }
  delete fields.amount;
  if (typeof fields.duration_seconds === "string") {
    const seconds = Number(fields.duration_seconds);
    if (!Number.isInteger(seconds))
      return { error: "duration_seconds must be a whole number" };
    fields.duration_seconds = seconds;
  }
  if (fields.amount_minor !== undefined && !currency)
    return { error: "An amount needs a currency" };
  const parsed = serverEventSchema.safeParse(fields);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error: `${issue?.path.join(".") || "row"}: ${issue?.message ?? "invalid"}`,
    };
  }
  return { event: parsed.data };
}

/**
 * Reads a CSV of outcomes (payments, leads, won deals) into events. Rows with
 * a problem are reported by row number and skipped; the rest are returned.
 */
export function parseAttributionCsv(text: string) {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
  });
  const errors: CsvRowError[] = parsed.errors
    .filter((e) => e.row !== undefined)
    .map((e) => ({ row: (e.row ?? 0) + 2, message: e.message }));
  if (parsed.data.length > CSV_MAX_ROWS)
    return {
      events: [] as ServerEvent[],
      errors: [
        {
          row: 0,
          message: `A file may have up to ${CSV_MAX_ROWS} rows; this one has ${parsed.data.length}. Split it.`,
        },
      ],
      rowCount: parsed.data.length,
      headers: parsed.meta.fields ?? [],
    };
  const events: ServerEvent[] = [];
  parsed.data.forEach((raw, i) => {
    const { event, error } = toEvent(raw);
    if (event) events.push(event);
    else errors.push({ row: i + 2, message: error ?? "invalid" });
  });
  return {
    events,
    errors,
    rowCount: parsed.data.length,
    headers: parsed.meta.fields ?? [],
  };
}
