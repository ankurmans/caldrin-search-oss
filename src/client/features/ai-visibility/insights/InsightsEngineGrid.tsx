import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { AI_ENGINE_LABELS, type AiEngine } from "@/shared/ai-visibility";
import type {
  AiVisibilityIntelligence,
  IntelBrand,
  IntelEngineVisibility,
} from "@/shared/ai-visibility-intelligence";
import { EngineIcon } from "../EngineIcon";
import { InsightsEvidence } from "./InsightsEvidence";
import { FormulaNote, pct, type InsightsFilters } from "./insightsShared";

type Selection = { brand: IntelBrand; sample: IntelEngineVisibility };

export function InsightsEngineGrid({
  projectId,
  data,
  filters,
}: {
  projectId: string;
  data: AiVisibilityIntelligence;
  filters: InsightsFilters;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const engines = data.options.engines.filter(
    (engine) => !filters.engines?.length || filters.engines.includes(engine),
  );
  if (!engines.length || !data.leaderboard.length)
    return (
      <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        No answers to compare for these filters.
      </p>
    );

  return (
    <section
      className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4 md:p-6"
      aria-label="Brand visibility by engine"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h3 className="inline-flex items-center gap-1 text-base font-semibold">
          Brand visibility by engine
          <FormulaNote
            label="engine visibility"
            text="Each percentage averages the mention rate of each tracked prompt with an answer on that engine. The count shows the answers naming the brand over all answers in the cell."
          />
        </h3>
        <p className="text-xs text-muted-foreground">
          Select a cell to see its answers.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead
              scope="col"
              className="sticky left-0 z-10 min-w-36 bg-card"
            >
              Brand
            </TableHead>
            {engines.map((engine) => (
              <TableHead
                key={engine}
                scope="col"
                className="min-w-28 text-center"
              >
                <span className="inline-flex items-center gap-1.5">
                  <EngineIcon engine={engine} className="size-4" />
                  {AI_ENGINE_LABELS[engine]}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.leaderboard.map((brand) => (
            <TableRow key={brand.domain}>
              <th
                scope="row"
                className="sticky left-0 z-10 bg-card px-2 py-2 text-left font-medium"
              >
                {brand.name}
                {brand.own ? (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    You
                  </span>
                ) : null}
              </th>
              {engines.map((engine) => (
                <TableCell key={engine} className="p-1">
                  <EngineCell
                    engine={engine}
                    brand={brand}
                    onSelect={(sample) => setSelection({ brand, sample })}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Sheet
        open={selection !== null}
        onOpenChange={(open) => {
          if (!open) setSelection(null);
        }}
      >
        {selection ? (
          <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-2xl">
            <SheetHeader className="pr-12">
              <SheetTitle>
                {selection.brand.name} on{" "}
                {AI_ENGINE_LABELS[selection.sample.engine]}
              </SheetTitle>
              <SheetDescription>
                {pct(selection.sample.visibility)} visibility · Named in{" "}
                {selection.sample.mentions} of {selection.sample.answers}{" "}
                answers · {selection.sample.prompts} prompts
              </SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-4">
              <InsightsEvidence
                projectId={projectId}
                filters={{ ...filters, engines: [selection.sample.engine] }}
                data={data}
                brandDomain={selection.brand.domain}
              />
            </div>
          </SheetContent>
        ) : null}
      </Sheet>
    </section>
  );
}

function EngineCell({
  engine,
  brand,
  onSelect,
}: {
  engine: AiEngine;
  brand: IntelBrand;
  onSelect: (sample: IntelEngineVisibility) => void;
}) {
  const sample = brand.byEngine.find((entry) => entry.engine === engine);
  if (!sample || sample.visibility === null) {
    return (
      <span className="block py-2 text-center text-xs text-muted-foreground">
        No answers
      </span>
    );
  }
  const visibility = pct(sample.visibility);
  return (
    <button
      type="button"
      className="block w-full rounded-md px-2 py-1.5 text-center tabular-nums hover:ring-1 hover:ring-inset hover:ring-foreground/30 focus-visible:outline-2 focus-visible:outline-ring"
      style={{
        backgroundColor: `color-mix(in oklab, var(--success) ${sample.visibility * 30}%, var(--muted))`,
      }}
      aria-label={`${brand.name} on ${AI_ENGINE_LABELS[engine]} at ${visibility} visibility, named in ${sample.mentions} of ${sample.answers} answers`}
      onClick={() => onSelect(sample)}
    >
      <span className="block font-semibold">{visibility}</span>
      <span className="block text-xs">
        {sample.mentions}/{sample.answers}
      </span>
    </button>
  );
}
