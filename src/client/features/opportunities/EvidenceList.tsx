import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { formatObserved } from "./helpers";

export type EvidenceRow = {
  id: string;
  source: string;
  label: string;
  value: string;
  url: string | null;
  observedAt: string | null;
};

export function EvidenceList({ evidence }: { evidence: EvidenceRow[] }) {
  if (evidence.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No evidence rows were stored for this recommendation.
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {evidence.map((row) => {
        const observed = formatObserved(row.observedAt);
        return (
          <li key={row.id} className="space-y-1 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-sm font-medium">{row.label}</span>
              <span className="text-sm tabular-nums">{row.value}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Source: {row.source}
              {observed ? ` · observed ${observed}` : ""}
            </p>
            {row.url ? (
              <SafeExternalLink
                url={row.url}
                label={row.url}
                className="inline-flex max-w-full items-center gap-1 break-all text-xs text-brand-text underline-offset-4 hover:underline"
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
