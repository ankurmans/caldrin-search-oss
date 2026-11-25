import { z } from "zod";

// How an enquiry reached the business, and how a call went. These ride on the
// event's small raw payload so the ledger needs no extra columns.

export const ENQUIRY_CHANNELS = [
  "form",
  "email",
  "phone",
  "chat",
  "calendar",
  "import",
] as const;

export const CALL_STATUSES = [
  "answered",
  "missed",
  "voicemail",
  "abandoned",
] as const;

export const HANDOFF_STATUSES = ["completed", "failed"] as const;

/** A call this long or longer is read as a conversation. It is a proxy, never a qualified lead. */
export const CALL_PROXY_SECONDS = 60;

/** The enquiry details an event may carry. Caller phone numbers are never stored. */
export const enquiryDetailsSchema = z.object({
  enquiry_channel: z.enum(ENQUIRY_CHANNELS).optional(),
  call_status: z.enum(CALL_STATUSES).optional(),
  duration_seconds: z
    .number()
    .int()
    .min(0)
    .max(6 * 60 * 60)
    .optional(),
  handoff: z.enum(HANDOFF_STATUSES).optional(),
  // Who in the business holds the lead or the deal, as the source system names them.
  lead_owner: z.string().trim().max(80).optional(),
  deal_owner: z.string().trim().max(80).optional(),
});
export type EnquiryDetails = z.infer<typeof enquiryDetailsSchema>;

const KEYS = [
  "enquiry_channel",
  "call_status",
  "duration_seconds",
  "handoff",
  "lead_owner",
  "deal_owner",
] as const;

/** The JSON stored with the event, or null when it carried no enquiry details. */
export function enquiryPayload(details: EnquiryDetails): string | null {
  const present = Object.fromEntries(
    KEYS.flatMap((k) => (details[k] === undefined ? [] : [[k, details[k]]])),
  );
  return Object.keys(present).length ? JSON.stringify(present) : null;
}

/** Reads details back from a stored payload; anything unreadable is no details. */
export function readEnquiryPayload(payload: string | null): EnquiryDetails {
  if (!payload) return {};
  try {
    const parsed = enquiryDetailsSchema.safeParse(JSON.parse(payload));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}
