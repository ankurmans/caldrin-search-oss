import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import {
  getAiVisibilityEvidencePage,
  getAiVisibilityIntelligence,
} from "@/serverFunctions/ai-visibility";
import type { AiPromptIntent } from "@/shared/ai-prompt-intent";
import type { AiEngine } from "@/shared/ai-visibility";
import type {
  IntelEvidenceCursor,
  IntelRate,
} from "@/shared/ai-visibility-intelligence";
import { aiVisibilityKey } from "../shared";

export interface InsightsFilters {
  days: 7 | 28 | 90;
  promptSetVersionId: string | null;
  engines: AiEngine[] | null;
  topic: string | null;
  branded: "all" | "branded" | "unbranded";
  intents: (AiPromptIntent | "unknown")[] | null;
  competitors: string[] | null;
  brand: string | null;
}

export const DEFAULT_INSIGHTS_FILTERS: InsightsFilters = {
  days: 28,
  promptSetVersionId: null,
  engines: null,
  topic: null,
  branded: "all",
  intents: null,
  competitors: null,
  brand: null,
};

export const insightsQueryOptions = (
  projectId: string,
  filters: InsightsFilters,
) =>
  queryOptions({
    queryKey: [...aiVisibilityKey(projectId), "insights", filters],
    queryFn: () =>
      getAiVisibilityIntelligence({ data: { projectId, ...filters } }),
  });

/**
 * Evidence pages for the brand and prompt set the figures above used, so the
 * list always matches them.
 */
export const insightsEvidenceQueryOptions = (
  projectId: string,
  filters: InsightsFilters,
  scope: { brand: string | null; promptSetVersionId: string | null },
) =>
  infiniteQueryOptions({
    queryKey: [
      ...aiVisibilityKey(projectId),
      "insightsEvidence",
      filters,
      scope,
    ],
    queryFn: ({ pageParam }) =>
      getAiVisibilityEvidencePage({
        data: { projectId, ...filters, ...scope, cursor: pageParam },
      }),
    initialPageParam: null as IntelEvidenceCursor | null,
    getNextPageParam: (page) => page.nextCursor,
  });

/** "42%" or "—" when there is nothing to divide by. */
export function pct(value: number | null, digits = 0) {
  return value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

/** "3 of 7", the denominator always shown beside a rate. */
export function ofText(rate: IntelRate) {
  return `${rate.numerator} of ${rate.denominator}`;
}

export function shortDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** An (i) button that shows exactly how a number is worked out. */
export function FormulaNote({ label, text }: { label: string; text: string }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`How ${label} is calculated`}
        className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
      >
        <Info className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent className="w-80 text-xs leading-relaxed">
        <p className="mb-1 font-medium text-foreground">{label}</p>
        <p className="text-muted-foreground">{text}</p>
      </PopoverContent>
    </Popover>
  );
}
