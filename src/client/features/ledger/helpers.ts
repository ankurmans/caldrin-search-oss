import { toast } from "sonner";

export function ledgerListKey(projectId: string) {
  return ["ledger", projectId, "list"] as const;
}

export function ledgerEntryKey(projectId: string, entryId: string) {
  return ["ledger", projectId, "entry", entryId] as const;
}

export function spendKey(projectId: string) {
  return ["ledger", projectId, "spend"] as const;
}

type Result<T> = { ok: true; data: T } | { ok: false; reason: string };

// Expected refusals come back as typed results; show them as a toast.
export function unwrap<T>(result: Result<T>): T | null {
  if (result.ok) return result.data;
  toast.error(result.reason);
  return null;
}

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info";

export const STATUS_LABELS: Record<string, string> = {
  proposed: "Proposed",
  approved: "Approved",
  rejected: "Rejected",
  executing: "Executing",
  executed: "Executed",
  failed: "Failed",
  rolled_back: "Rolled back",
  abandoned: "Abandoned",
};

export function statusVariant(status: string): BadgeVariant {
  switch (status) {
    case "executed":
      return "success";
    case "approved":
      return "info";
    case "executing":
    case "proposed":
      return "warning";
    case "failed":
    case "rejected":
      return "destructive";
    default:
      return "outline";
  }
}

export function humanize(value: string): string {
  const text = value.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "-";
  // SQLite's current_timestamp has no zone; treat it as UTC.
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value)
    ? value
    : `${value.replace(" ", "T")}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDay(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `$${value.toFixed(value !== 0 && Math.abs(value) < 1 ? 4 : 2)}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${(value * 100).toFixed(1)}%`;
}
