import { formatNumber } from "@/client/features/keywords/utils";
import { formatRelativeTime } from "@/client/lib/relative-time";
import { LOCATIONS } from "@/shared/keyword-locations";
import type { GapData } from "./gap";

/** Where the rows came from and how much of the provider's data was read. */
export function GapCoverage({ data }: { data: GapData }) {
  const market = LOCATIONS[data.run.locationCode] ?? `${data.run.locationCode}`;
  return (
    <section
      aria-label="Coverage"
      className="rounded-xl border bg-card p-3 text-sm"
    >
      <p>
        <strong>{data.run.targetDomain}</strong> compared in {market} (
        {data.run.languageCode.toUpperCase()}), read{" "}
        {formatRelativeTime(data.run.createdAt)}
        {data.run.status === "partial"
          ? ". Some competitors could not be read."
          : ""}
        .
      </p>
      <ul className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
        {data.competitors.map((competitor) => (
          <li key={`${competitor.competitorDomain}-${competitor.kind}`}>
            {competitor.competitorDomain} (
            {competitor.kind === "missing" ? "missing" : "outranked"}):{" "}
            {competitor.status === "ok"
              ? `read ${competitor.rowsRead}${
                  competitor.providerTotal !== null
                    ? ` of ${formatNumber(competitor.providerTotal)} the provider counted`
                    : ""
                }`
              : `failed, ${competitor.error ?? "no detail"}`}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Each read is the most-searched keywords the provider returned, not every
        keyword a site ranks for. Treat gaps as a sample, not the whole market.
      </p>
    </section>
  );
}
