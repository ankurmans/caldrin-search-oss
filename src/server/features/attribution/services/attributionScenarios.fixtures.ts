// Synthetic validation data. Every record here is invented to exercise the
// attribution pipeline; none of it describes a real business or its results.

const DAY = 86_400_000;
const HOUR = 3_600_000;
const daysAgo = (days: number, plusHours = 0) =>
  new Date(Date.now() - days * DAY + plusHours * HOUR).toISOString();

export const LUMA_BRANDS = ["Luma Creative", "Westwave AV"] as const;
export const LUMA_ENQUIRIES = 155;
export const LUMA_UNKNOWN_SOURCES = 62;

// What enquirers typed, as typed. "Google" is deliberately ambiguous.
const LUMA_WORDS = [
  "Google",
  "Googled you and found your site",
  "LinkedIn",
  "A colleague recommended you",
  "ChatGPT suggested you",
  "Google Maps",
];

/**
 * A parent company with two operating brands and 155 enquiries in 25 days,
 * as a CRM would export them: 62 with no word about how they were found, a
 * few received by the wrong brand, a few recorded twice, and a pipeline that
 * ends in five won deals.
 */
export function lumaCrmRecords() {
  const records: unknown[] = [];
  let known = 0;
  for (let n = 0; n < LUMA_ENQUIRIES; n++) {
    const ago = (n % 25) + 1;
    const westwave = n % 5 === 4;
    const wrongInbox = westwave ? n % 20 === 4 : n % 6 === 0;
    const unknown = (n * 7) % LUMA_ENQUIRIES < LUMA_UNKNOWN_SOURCES;
    const lead = {
      record_type: "lead",
      brand: westwave ? "Westwave AV" : "Luma Creative",
      intended_brand: wrongInbox
        ? westwave
          ? "Luma Creative"
          : "Westwave AV"
        : n % 3 === 0
          ? westwave
            ? "Westwave AV"
            : "Luma Creative"
          : undefined,
      contact_id: `C${n}`,
      channel: n % 2 ? "form" : "email",
      how_heard: unknown ? undefined : LUMA_WORDS[known++ % LUMA_WORDS.length],
      owner: n % 2 ? "Priya" : "Sam",
      status: n % 4 === 0 ? "qualified" : "new",
      created_at: daysAgo(ago),
      qualified_at: daysAgo(ago, 2),
    };
    records.push({ ...lead, id: `L${n}` });
    // The same enquiry entered a second time under another CRM record id.
    if (n % 25 === 3)
      records.push({ ...lead, id: `L${n}-again`, lead_id: `L${n}` });
    if (n % 8 !== 0) continue;
    const d = n / 8;
    const stage = (["won", "lost", "booked", "proposal"] as const)[d % 4];
    const contract = 500_000 + 25_000 * d;
    records.push({
      record_type: "deal",
      id: `D${n}`,
      brand: lead.brand,
      intended_brand: lead.intended_brand,
      contact_id: `C${n}`,
      lead_id: `L${n}`,
      owner: "Dana",
      stage,
      amount_minor: contract,
      currency: "USD",
      created_at: daysAgo(ago, 3),
      stage_changed_at: daysAgo(ago, 6),
    });
    if (stage === "won" && d % 8 === 0)
      records.push({
        record_type: "payment",
        id: `P${n}`,
        deal_id: `D${n}`,
        amount_minor: contract / 2,
        currency: "USD",
        paid_at: daysAgo(ago, 12),
      });
  }
  return records;
}

const BASEMENT_CALLS = 80;
const BASEMENT_FORMS = 25;

/**
 * A local service business: calls from tracking numbers shown on Google
 * search and Maps listings and on a referral flyer, some missed, some
 * mishandled after pick-up, and a few that can be followed to a job.
 */
export function basementCallRecords() {
  const sources = [
    { utm_source: "google", utm_medium: "organic" },
    { utm_source: "gbp", utm_medium: "listing" },
    { utm_source: "neighbour-flyer", utm_medium: "print" },
  ];
  return Array.from({ length: BASEMENT_CALLS }, (_, n) => {
    const status =
      n % 8 === 7
        ? "voicemail"
        : n % 10 === 9
          ? "abandoned"
          : n % 4 === 3
            ? "missed"
            : "answered";
    const answered = status === "answered";
    return {
      call_id: `call-${n}`,
      started_at: daysAgo((n % 20) + 1, n % 12),
      status,
      duration_seconds: answered ? (n % 3 === 0 ? 38 : 95 + n) : 0,
      handoff: answered ? (n % 11 === 0 ? "failed" : "completed") : undefined,
      brand: "603 Basement Solutions",
      ...sources[n % sources.length],
      // The tracker matched these callers to a form or CRM contact.
      lead_id: n < 12 ? `bsmt-L${n}` : undefined,
    };
  });
}

/** Web form enquiries to the same business, with what each person said. */
export function basementFormEvents() {
  const words = ["Google", "My neighbour", "Saw your truck", "Facebook group"];
  return Array.from({ length: BASEMENT_FORMS }, (_, n) => ({
    event_id: `bsmt-form-${n}`,
    type: "lead" as const,
    occurred_at: daysAgo((n % 18) + 1),
    lead_id: `bsmt-F${n}`,
    brand: "603 Basement Solutions",
    enquiry_channel: "form" as const,
    self_reported_source: words[n % words.length],
  }));
}

/** Of the first twelve callers: seven qualified, five inspections, three jobs, two paid. */
export function basementJobRecords() {
  const records: unknown[] = [];
  for (let n = 0; n < 12; n++) {
    const stage = n < 7 ? (n < 5 ? "booked" : "qualified") : null;
    if (stage)
      records.push({
        record_type: "deal",
        id: `bsmt-D${n}`,
        brand: "603 Basement Solutions",
        lead_id: `bsmt-L${n}`,
        stage,
        created_at: daysAgo(10),
        stage_changed_at: daysAgo(9),
      });
    if (n < 3) {
      records.push({
        record_type: "deal",
        id: `bsmt-D${n}`,
        brand: "603 Basement Solutions",
        lead_id: `bsmt-L${n}`,
        stage: "won",
        amount_minor: 850_000 + n * 100_000,
        currency: "USD",
        created_at: daysAgo(10),
        stage_changed_at: daysAgo(6),
      });
      if (n < 2)
        records.push({
          record_type: "payment",
          id: `bsmt-P${n}`,
          deal_id: `bsmt-D${n}`,
          amount_minor: 425_000,
          currency: "USD",
          paid_at: daysAgo(3),
        });
    }
  }
  return records;
}
