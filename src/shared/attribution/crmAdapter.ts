import { z } from "zod";
import {
  serverEventSchema,
  type ServerEvent,
} from "@/types/schemas/attribution";
import { ENQUIRY_CHANNELS } from "./enquiry";
import { toMinorUnits } from "./money";

// The contract a CRM export or webhook is mapped to. It is deliberately
// generic: a lead, a deal and a payment, with the ids the CRM itself holds.

const id = z.string().trim().min(1).max(200);
const text = (max: number) => z.string().trim().max(max);
const when = z.iso.datetime({ offset: true });

const amount = {
  amount_minor: z.number().int().optional(),
  // A decimal in the currency's major unit, for exports that have no minor units.
  amount: z.union([z.string(), z.number()]).optional(),
  currency: z.string().trim().length(3).optional(),
};

const shared = {
  id,
  brand: text(120).optional(),
  intended_brand: text(120).optional(),
  contact_id: id.optional(),
  lead_id: id.optional(),
  visitor_id: id.optional(),
  owner: text(80).optional(),
  ...amount,
};

const leadRecord = z.object({
  record_type: z.literal("lead"),
  ...shared,
  created_at: when,
  qualified_at: when.optional(),
  status: z
    .enum(["new", "qualified", "disqualified", "duplicate"])
    .default("new"),
  channel: z.enum(ENQUIRY_CHANNELS).optional(),
  // What the enquirer said, kept exactly as written.
  how_heard: text(500).optional(),
  landing_url: text(2048).optional(),
  referrer: text(2048).optional(),
});

const dealRecord = z.object({
  record_type: z.literal("deal"),
  ...shared,
  created_at: when,
  stage: z.enum(["open", "qualified", "proposal", "booked", "won", "lost"]),
  stage_changed_at: when.optional(),
});

const paymentRecord = z.object({
  record_type: z.literal("payment"),
  ...shared,
  deal_id: id.optional(),
  paid_at: when,
});

const crmRecordSchema = z.discriminatedUnion("record_type", [
  leadRecord,
  dealRecord,
  paymentRecord,
]);
type CrmRecord = z.infer<typeof crmRecordSchema>;

function minor(record: z.infer<z.ZodObject<typeof amount>>) {
  if (record.amount_minor !== undefined) return record.amount_minor;
  if (record.amount === undefined || !record.currency) return undefined;
  return toMinorUnits(String(record.amount), record.currency) ?? undefined;
}

/**
 * Maps one CRM record to the ledger's events. Each event id is built from the
 * CRM's own record id and the stage, so a record sent again lands once and a
 * deal that moves on adds an event instead of rewriting the last one. Stages
 * that are not yet an outcome, such as a new unqualified deal, produce none.
 */
function eventsOf(system: string, record: CrmRecord): unknown[] {
  const prefix = `crm:${system}:${record.record_type}:${record.id}`;
  const base = {
    brand: record.brand,
    intended_brand: record.intended_brand,
    contact_id: record.contact_id,
    visitor_id: record.visitor_id,
    amount_minor: minor(record),
    currency: record.currency,
  };
  if (record.record_type === "lead") {
    const lead = {
      ...base,
      lead_id: record.lead_id ?? record.id,
      lead_owner: record.owner,
      enquiry_channel: record.channel,
      self_reported_source: record.how_heard,
      url: record.landing_url,
      referrer: record.referrer,
    };
    return [
      {
        ...lead,
        event_id: prefix,
        type: "lead",
        occurred_at: record.created_at,
        stage: record.status === "duplicate" ? "duplicate" : undefined,
      },
      ...(record.status === "qualified"
        ? [
            {
              ...lead,
              event_id: `${prefix}:qualified`,
              type: "qualified_lead",
              occurred_at: record.qualified_at ?? record.created_at,
            },
          ]
        : []),
    ];
  }
  if (record.record_type === "deal") {
    const type = {
      qualified: "qualified_lead",
      proposal: "qualified_lead",
      booked: "booking",
      won: "deal_won",
      lost: "deal_lost",
      open: null,
    }[record.stage];
    if (!type) return [];
    return [
      {
        ...base,
        lead_id: record.lead_id,
        deal_id: record.id,
        deal_owner: record.owner,
        event_id: `${prefix}:${record.stage}`,
        type,
        occurred_at: record.stage_changed_at ?? record.created_at,
        stage: record.stage,
      },
    ];
  }
  return [
    {
      ...base,
      lead_id: record.lead_id,
      deal_id: record.deal_id,
      order_id: record.id,
      event_id: prefix,
      type: "payment",
      occurred_at: record.paid_at,
    },
  ];
}

export type AdapterResult = {
  events: ServerEvent[];
  /** Records that produced no event, and records that did not fit the contract. */
  skipped: number;
  errors: { index: number; message: string }[];
};

/** Validates CRM records and maps them to ledger events. */
export function normalizeCrmRecords(
  system: string,
  records: unknown[],
): AdapterResult {
  const events: ServerEvent[] = [];
  const errors: AdapterResult["errors"] = [];
  let skipped = 0;
  records.forEach((raw, index) => {
    const parsed = crmRecordSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      errors.push({
        index,
        message: `${issue?.path.join(".") || "record"}: ${issue?.message ?? "invalid"}`,
      });
      return;
    }
    const mapped = eventsOf(system, parsed.data);
    if (mapped.length === 0) skipped += 1;
    for (const candidate of mapped) {
      const event = serverEventSchema.safeParse(candidate);
      if (event.success) events.push(event.data);
      else
        errors.push({
          index,
          message: event.error.issues[0]?.message ?? "invalid event",
        });
    }
  });
  return { events, skipped, errors };
}
