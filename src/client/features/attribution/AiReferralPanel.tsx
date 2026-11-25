import { Badge } from "@/client/components/ui/badge";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import type { getAttributionAiReferralsFn } from "@/serverFunctions/attributionSearch";
import { formatCredited, moneyLines } from "./format";

type Referrals = Awaited<ReturnType<typeof getAttributionAiReferralsFn>>;

const total = (credited: Record<string, number>) =>
  Object.values(credited).reduce((n, v) => n + v, 0);

/**
 * Visits and outcomes that came from AI assistants. Sessions and credit are
 * first-party; "Said so" is what buyers wrote; answers citing a page are
 * Associated with it; GA4 is a cross-check only.
 */
export function AiReferralPanel({
  referrals,
  onOpen,
}: {
  referrals: Referrals;
  onOpen: (host: string, path: string) => void;
}) {
  const { assistants, pages, citedWithoutVisits, ga4, reportingCurrency } =
    referrals;
  if (assistants.length === 0 && pages.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No AI-referred visits or AI mentions in this period. {referrals.note}
      </p>
    );
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{referrals.note}</p>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Assistant</TableHead>
              <TableHead className="text-right">Sessions</TableHead>
              <TableHead className="text-right">Outcomes credited</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">
                Said so <Badge variant="soft">Self-reported</Badge>
              </TableHead>
              {ga4.status === "ok" ? (
                <TableHead className="text-right">GA4 sessions</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {assistants.map((a) => (
              <TableRow key={a.name}>
                <TableCell className="font-medium">{a.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {a.sessions || "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {total(a.credited) ? formatCredited(total(a.credited)) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {a.revenue.length
                    ? moneyLines(a.revenue, reportingCurrency).join(" · ")
                    : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {a.selfReported || "—"}
                </TableCell>
                {ga4.status === "ok" ? (
                  <TableCell className="text-right tabular-nums">
                    {ga4.assistants.find((g) => g.name === a.name)?.sessions ??
                      "—"}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
      {ga4.status === "ok" && !ga4.comparable ? (
        <p className="text-xs text-muted-foreground">
          GA4 counts cover its last 28 complete days, so compare them with the
          28-day range.
        </p>
      ) : null}

      {pages.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Pages AI visitors land on</h3>
          <TableCard>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Page</TableHead>
                  <TableHead className="text-right">AI sessions</TableHead>
                  <TableHead className="text-right">Outcomes</TableHead>
                  <TableHead className="text-right">
                    AI answers citing it{" "}
                    <Badge variant="secondary">Associated</Badge>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pages.map((p) => (
                  <TableRow key={`${p.host}${p.path}`}>
                    <TableCell className="max-w-72 truncate">
                      <button
                        type="button"
                        className="font-medium underline-offset-2 hover:underline"
                        onClick={() => onOpen(p.host, p.path)}
                      >
                        {p.path}
                      </button>
                      <div className="text-xs text-muted-foreground">
                        {p.host}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.sessions || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {total(p.credited)
                        ? formatCredited(total(p.credited))
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.citedAnswers || "—"}
                      {p.citedEngines.length ? (
                        <div className="text-xs text-muted-foreground">
                          {p.citedEngines.join(", ")}
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        </section>
      ) : null}

      {citedWithoutVisits.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Cited in AI answers with no AI-referred visit recorded:{" "}
          {citedWithoutVisits.map((p) => `${p.host}${p.path}`).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
