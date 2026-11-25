import { sort } from "remeda";
import { formatMoney } from "@/shared/attribution/money";
import {
  CHANNELS,
  CHANNEL_LABELS,
  narrow,
  type Evidence,
} from "@/shared/attribution/vocabulary";

export const channelLabel = (channel: string) =>
  CHANNEL_LABELS[narrow(CHANNELS, channel) ?? "unknown"];

/** Money in the reporting currency first, then anything else on its own line. */
export function moneyLines(
  money: { currency: string; minor: number }[],
  reportingCurrency: string,
) {
  const sorted = sort(
    money,
    (a, b) =>
      Number(b.currency === reportingCurrency) -
        Number(a.currency === reportingCurrency) ||
      a.currency.localeCompare(b.currency),
  );
  return sorted.map((m) => formatMoney(m.minor, m.currency));
}

export const formatCredited = (value: number) =>
  value >= 10
    ? Math.round(value).toString()
    : value.toFixed(1).replace(/\.0$/, "");

export const percent = (bp: number) =>
  `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 1)}%`;

export const EVIDENCE_BADGE: Record<
  Evidence,
  "success" | "info" | "soft" | "warning" | "secondary" | "outline"
> = {
  observed: "success",
  linked: "info",
  self_reported: "soft",
  associated: "secondary",
  modelled: "warning",
  unknown: "outline",
};

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export const STAGE_LABELS: Record<string, string> = {
  enquiry: "Enquiry only",
  qualified: "Qualified",
  booked: "Booked",
  won: "Won",
  lost: "Lost",
};
