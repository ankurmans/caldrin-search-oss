import { z } from "zod";
import {
  serverEventSchema,
  type ServerEvent,
} from "@/types/schemas/attribution";
import { CALL_STATUSES, HANDOFF_STATUSES } from "./enquiry";
import type { AdapterResult } from "./crmAdapter";

// A provider-neutral call record. A call tracker's export or webhook is mapped
// to this; the caller's phone number is deliberately not part of it.

const id = z.string().trim().min(1).max(200);

const callRecordSchema = z.object({
  call_id: id,
  started_at: z.iso.datetime({ offset: true }),
  duration_seconds: z
    .number()
    .int()
    .min(0)
    .max(6 * 60 * 60),
  status: z.enum(CALL_STATUSES),
  handoff: z.enum(HANDOFF_STATUSES).optional(),
  // The brand whose tracking number was called, and the one the caller wanted.
  brand: z.string().trim().max(120).optional(),
  intended_brand: z.string().trim().max(120).optional(),
  // How the tracking number was shown to the caller.
  utm_source: z.string().trim().max(200).optional(),
  utm_medium: z.string().trim().max(200).optional(),
  utm_campaign: z.string().trim().max(200).optional(),
  landing_url: z.string().trim().max(2048).optional(),
  referrer: z.string().trim().max(2048).optional(),
  // Ids the tracker itself matched to the call; only these ever join a call to a person.
  visitor_id: id.optional(),
  lead_id: id.optional(),
  contact_id: id.optional(),
  lead_owner: z.string().trim().max(80).optional(),
});

/** Validates call records and maps each to a `call` event. */
export function normalizeCallRecords(
  provider: string,
  records: unknown[],
): AdapterResult {
  const events: ServerEvent[] = [];
  const errors: AdapterResult["errors"] = [];
  records.forEach((raw, index) => {
    const parsed = callRecordSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      errors.push({
        index,
        message: `${issue?.path.join(".") || "record"}: ${issue?.message ?? "invalid"}`,
      });
      return;
    }
    const call = parsed.data;
    const event = serverEventSchema.safeParse({
      event_id: `call:${provider}:${call.call_id}`,
      type: "call",
      occurred_at: call.started_at,
      brand: call.brand,
      intended_brand: call.intended_brand,
      utm_source: call.utm_source,
      utm_medium: call.utm_medium,
      utm_campaign: call.utm_campaign,
      url: call.landing_url,
      referrer: call.referrer,
      visitor_id: call.visitor_id,
      lead_id: call.lead_id,
      contact_id: call.contact_id,
      lead_owner: call.lead_owner,
      enquiry_channel: "phone",
      call_status: call.status,
      duration_seconds: call.duration_seconds,
      handoff: call.handoff,
    });
    if (event.success) events.push(event.data);
    else
      errors.push({
        index,
        message: event.error.issues[0]?.message ?? "invalid event",
      });
  });
  return { events, skipped: 0, errors };
}
