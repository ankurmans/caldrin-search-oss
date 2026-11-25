import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/client/components/ui/button";
import { CardShell } from "@/client/components/CardShell";
import { getCitationProspects } from "@/serverFunctions/source-intelligence";
import type { SourceFilters } from "@/types/schemas/source-intelligence";
import { SourceDetailSheet } from "./SourceDetailSheet";
import { sourceKeys, type SourceTableRow } from "./sourceIntelligence";

export function CitationProspects({
  projectId,
  filters,
}: {
  projectId: string;
  filters: SourceFilters;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<SourceTableRow | null>(null);
  const query = useQuery({
    queryKey: [...sourceKeys.all(projectId), "citation-prospects", filters],
    queryFn: () => getCitationProspects({ data: { projectId, filters } }),
    enabled: open,
  });
  return (
    <CardShell
      title="Citation opportunities"
      action={
        <Button
          size="sm"
          variant="outline"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide opportunities" : "Show opportunities"}
        </Button>
      }
    >
      {open ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Independent pages cited at least twice that appeared in answers
            naming a tracked competitor.
          </p>
          {query.isPending ? (
            <p role="status">Reading saved citations…</p>
          ) : null}
          {query.isError ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void query.refetch()}
            >
              Retry
            </Button>
          ) : null}
          {query.data?.length === 0 ? (
            <p>No matching pages in these filters.</p>
          ) : null}
          {query.data?.length ? (
            <ul className="divide-y">
              {query.data.map((row) => (
                <li
                  key={row.key}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="font-medium break-words">
                      {row.title ?? row.key}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.domain} · {row.citedAnswers} citing answers ·
                      Competitors named in these answers:{" "}
                      {row.competitors
                        .map((brand) => `${brand.name} (${brand.answers})`)
                        .join(", ")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelected(row)}
                  >
                    View evidence
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <SourceDetailSheet
        projectId={projectId}
        filters={filters}
        row={selected}
        onClose={() => setSelected(null)}
      />
    </CardShell>
  );
}
