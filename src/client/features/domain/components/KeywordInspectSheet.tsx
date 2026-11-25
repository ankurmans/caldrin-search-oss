import { Link } from "@tanstack/react-router";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { ExternalUrlCell } from "@/client/components/table/url";
import { ScoreBadge } from "@/client/components/table/ScoreBadge";
import { KeywordChangeCell } from "@/client/features/domain/components/KeywordChangeCell";
import { intentLabel } from "@/client/features/domain/components/KeywordIntentBadge";
import { serpFeatureLabel } from "@/client/features/domain/components/KeywordSerpFeatures";
import type { KeywordRow } from "@/client/features/domain/types";
import { formatNumber, formatRounded } from "@/client/features/domain/utils";

type Props = {
  projectId: string;
  domain: string;
  locationCode: number | undefined;
  row: KeywordRow | null;
  onClose: () => void;
};

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium tabular-nums">{children}</div>
    </div>
  );
}

function VolumeHistory({ months }: { months: KeywordRow["monthlySearches"] }) {
  if (months.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        The provider returned no monthly volumes for this keyword.
      </p>
    );
  }
  const max = Math.max(...months.map((m) => m.volume), 1);
  return (
    <div className="space-y-1">
      <div
        className="flex h-16 items-end gap-1"
        role="img"
        aria-label="Monthly search volume"
      >
        {months.map((m) => (
          <div
            key={m.month}
            className="flex-1 rounded-t bg-amber-400"
            style={{ height: `${Math.max((m.volume / max) * 100, 2)}%` }}
            title={`${m.month}: ${formatNumber(m.volume)}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{months[0]?.month}</span>
        <span>{months.at(-1)?.month}</span>
      </div>
    </div>
  );
}

/** Everything the ranked-keywords reading holds about one keyword. */
export function KeywordInspectSheet({
  projectId,
  domain,
  locationCode,
  row,
  onClose,
}: Props) {
  return (
    <Sheet open={row != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        {row ? (
          <>
            <SheetHeader>
              <SheetTitle>{row.keyword}</SheetTitle>
              <SheetDescription>
                {domain} ranking, from the provider's last reading of the
                results.
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6">
              <div className="grid grid-cols-3 gap-4">
                <Stat label="Rank">{row.position ?? "-"}</Stat>
                <Stat label="Previous rank">{row.previousPosition ?? "-"}</Stat>
                <Stat label="Change">
                  <KeywordChangeCell row={row} />
                </Stat>
                <Stat label="Volume">{formatNumber(row.searchVolume)}</Stat>
                <Stat label="Est. traffic">{formatRounded(row.traffic)}</Stat>
                <Stat label="CPC">
                  {row.cpc == null ? "-" : `$${row.cpc.toFixed(2)}`}
                </Stat>
                <Stat label="Difficulty">
                  <ScoreBadge value={row.keywordDifficulty} />
                </Stat>
                <Stat label="Intent">{intentLabel(row.intent)}</Stat>
              </div>

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Monthly search volume</h3>
                <VolumeHistory months={row.monthlySearches} />
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Features on the results</h3>
                {row.serpFeatures.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {row.serpFeatures.map((feature) => (
                      <li
                        key={feature}
                        className="rounded bg-muted px-2 py-0.5 text-xs"
                      >
                        {serpFeatureLabel(feature)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    None reported besides organic results.
                  </p>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Ranking page</h3>
                <ExternalUrlCell
                  value={row.url || row.relativeUrl}
                  label={row.relativeUrl ?? row.url ?? ""}
                  baseDomain={domain}
                />
              </section>

              <p className="text-xs text-muted-foreground">
                Results read {row.serpCheckedAt ?? "on an unknown date"}
                {row.previousSerpCheckedAt
                  ? `; the previous reading was ${row.previousSerpCheckedAt}`
                  : ""}
                . Rank change compares those two readings.
              </p>

              <Link
                to="/p/$projectId/keywords"
                params={{ projectId }}
                search={{ q: row.keyword, loc: locationCode }}
                className="text-sm font-medium underline underline-offset-4 hover:no-underline"
              >
                Research this keyword
              </Link>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
