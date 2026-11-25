import { MarketReportDelivery } from "./MarketReportDelivery";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { CardShell } from "@/client/components/CardShell";
import { AI_ENGINE_LABELS } from "@/shared/ai-visibility";
import {
  createMarketReport,
  listMarketReportMarkets,
  previewMarketReport,
} from "@/serverFunctions/reports";

const DAYS = [7, 28, 90] as const;
const rate = (value: number | null) =>
  value === null ? "—" : `${Math.round(value * 100)}%`;

export function MarketReport({
  projectId,
  onSaved,
}: {
  projectId: string;
  onSaved: (reportId: string) => void;
}) {
  const [opened, setOpened] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [days, setDays] = useState<(typeof DAYS)[number]>(28);
  const markets = useQuery({
    queryKey: ["market-report-markets", projectId],
    queryFn: () => listMarketReportMarkets({ data: { projectId } }),
    enabled: opened,
  });
  const picked = (markets.data ?? []).filter((market) =>
    selected.includes(market.key),
  );
  const input = {
    projectId,
    days,
    markets: picked.map(({ locationCode, languageCode }) => ({
      locationCode,
      languageCode,
    })),
  };
  const preview = useMutation({
    mutationFn: () => previewMarketReport({ data: input }),
  });
  const save = useMutation({
    mutationFn: () => createMarketReport({ data: input }),
    onSuccess: (report) => onSaved(report.reportId),
  });
  const busy = preview.isPending || save.isPending;

  return (
    <CardShell
      title="AI visibility by market"
      action={
        <Button
          variant="outline"
          size="sm"
          aria-expanded={opened}
          onClick={() => setOpened(!opened)}
        >
          {opened ? "Close comparison" : "Compare markets"}
        </Button>
      }
    >
      {opened ? (
        <div className="space-y-3 text-sm">
          {markets.isPending ? <p role="status">Loading markets…</p> : null}
          {markets.isError ? <p role="alert">Could not load markets.</p> : null}
          {markets.data && markets.data.length < 2 ? (
            <p>Collect AI answers in two markets to compare them here.</p>
          ) : null}
          {markets.data && markets.data.length >= 2 ? (
            <>
              <fieldset
                className="flex flex-wrap items-center gap-3"
                disabled={busy}
              >
                <legend className="mb-2 text-muted-foreground">
                  Choose two to four markets
                </legend>
                {markets.data.map((market) => (
                  <label
                    key={market.key}
                    className="inline-flex items-center gap-2 rounded-md border px-2 py-1.5"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(market.key)}
                      disabled={
                        !selected.includes(market.key) && selected.length >= 4
                      }
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setSelected((keys) =>
                          checked
                            ? [...keys, market.key]
                            : keys.filter((key) => key !== market.key),
                        );
                        preview.reset();
                        save.reset();
                      }}
                    />
                    {market.label}
                  </label>
                ))}
              </fieldset>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2">
                  Window
                  <select
                    value={days}
                    disabled={busy}
                    className="rounded-md border bg-background px-2 py-1"
                    onChange={(event) => {
                      const next = DAYS.find(
                        (choice) => String(choice) === event.target.value,
                      );
                      if (next) setDays(next);
                      preview.reset();
                      save.reset();
                    }}
                  >
                    {DAYS.map((choice) => (
                      <option key={choice} value={choice}>
                        Last {choice} days
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  pending={preview.isPending}
                  disabled={picked.length < 2 || busy}
                  onClick={() => preview.mutate()}
                >
                  Preview comparison
                </Button>
                {preview.data ? (
                  <Button
                    size="sm"
                    pending={save.isPending}
                    disabled={busy}
                    onClick={() => save.mutate()}
                  >
                    Save report
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
          {preview.isError || save.isError ? (
            <p role="alert">Could not prepare this report. Try again.</p>
          ) : null}
          {preview.data ? <MarketRows rows={preview.data.rows} /> : null}
          <MarketReportDelivery
            input={input}
            canSchedule={Boolean(preview.data && !busy)}
          />
        </div>
      ) : null}
    </CardShell>
  );
}

function MarketRows({
  rows,
}: {
  rows: Awaited<ReturnType<typeof previewMarketReport>>["rows"];
}) {
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground">
        Each market uses its own saved sample. Check prompt set, dates and
        engine coverage before interpreting differences.
      </p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left">
          <thead className="border-b">
            <tr>
              {[
                "Market",
                "Visibility",
                "Cited",
                "Answers",
                "Engines",
                "Prompt set",
                "Collected",
              ].map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="whitespace-nowrap p-2 font-medium"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className="p-2 font-medium">
                  {row.label}
                </th>
                <td className="p-2">{rate(row.visibility)}</td>
                <td className="p-2">{rate(row.citation)}</td>
                <td className="p-2 tabular-nums">
                  {row.answers} / {row.planned}
                </td>
                <td className="p-2">
                  {row.engines
                    .map((engine) => AI_ENGINE_LABELS[engine])
                    .join(", ") || "—"}
                </td>
                <td className="p-2">{row.promptSet ?? "—"}</td>
                <td className="p-2">
                  {row.observed
                    ? `${row.observed.start.slice(0, 10)} to ${row.observed.end.slice(0, 10)}`
                    : "No collection"}
                  {row.truncated ? " (limited sample)" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
