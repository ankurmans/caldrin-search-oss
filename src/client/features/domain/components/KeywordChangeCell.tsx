import type { KeywordRow } from "@/client/features/domain/types";

/** Rank movement since the provider's previous reading of the results. */
export function KeywordChangeCell({ row }: { row: KeywordRow }) {
  if (row.change === "new") {
    return <span className="font-medium text-blue-600">New</span>;
  }
  if (row.change == null || row.change === "same") {
    return <span className="text-muted-foreground">-</span>;
  }
  const steps =
    row.position != null && row.previousPosition != null
      ? Math.abs(row.previousPosition - row.position)
      : null;
  const up = row.change === "up";
  return (
    <span
      className={`tabular-nums font-medium ${up ? "text-green-600" : "text-red-600"}`}
    >
      {up ? "↑" : "↓"}
      {steps ?? ""}
    </span>
  );
}
