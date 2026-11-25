import { formatCompactDate } from "@/client/features/backlinks/backlinksPageUtils";

/** Where a figure came from and when it was read. */
export function SourceNote({
  source,
  date,
}: {
  source: string;
  date: string | null | undefined;
}) {
  return (
    <p className="text-xs text-muted-foreground">
      {source}
      {date ? ` · ${formatCompactDate(date.slice(0, 10))}` : ""}
    </p>
  );
}

export const DATAFORSEO_ESTIMATE = "DataForSEO estimate";
