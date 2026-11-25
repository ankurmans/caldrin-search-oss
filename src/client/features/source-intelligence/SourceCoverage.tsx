import { Badge } from "@/client/components/ui/badge";
import { engineLabel, type SourceData } from "./sourceIntelligence";

/**
 * What each engine's answers let a reader say. "Not captured" rows were saved
 * before searches and retrieved pages were read: they are unknown, not empty.
 */
export function SourceCoverage({ data }: { data: SourceData }) {
  if (data.coverage.length === 0) {
    return (
      <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        No answered collections in this window. Run a prompt check from Prompt
        tracking first.
      </p>
    );
  }
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-sm font-semibold">
        Evidence coverage across {data.answers} answers
      </h2>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-4 font-medium">Engine</th>
                <th className="py-1 pr-4 text-right font-medium">Answers</th>
                <th className="py-1 pr-4 text-right font-medium">
                  Search list returned
                </th>
                <th className="py-1 pr-4 text-right font-medium">
                  Retrieval list returned
                </th>
                <th className="py-1 pr-4 text-right font-medium">
                  With cited pages
                </th>
                <th className="py-1 text-right font-medium">Not captured</th>
              </tr>
            </thead>
            <tbody>
              {data.coverage.map((row) => (
                <tr key={row.engine} className="border-t">
                  <td className="py-1.5 pr-4">{engineLabel(row.engine)}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">
                    {row.answers}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">
                    {row.queriesExposed}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">
                    {row.retrievalExposed}
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">
                    {row.withCitations}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {row.notCaptured > 0 ? (
                      <Badge variant="soft">{row.notCaptured}</Badge>
                    ) : (
                      0
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-2">
          {data.notes.length > 0 ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {data.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}
