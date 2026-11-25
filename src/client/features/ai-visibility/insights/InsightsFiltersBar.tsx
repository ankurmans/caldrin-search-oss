import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  AI_PROMPT_INTENT_LABELS,
  type AiPromptIntent,
} from "@/shared/ai-prompt-intent";
import type { AiVisibilityIntelligence } from "@/shared/ai-visibility-intelligence";
import { EngineFilter } from "../EngineFilter";
import type { InsightsFilters } from "./insightsShared";

const PERIODS = [
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "28", label: "Last 28 days", days: 28 },
  { value: "90", label: "Last 90 days", days: 90 },
] as const;
const PROMPT_TYPES = [
  { value: "all", label: "All prompts" },
  { value: "unbranded", label: "Unbranded prompts" },
  { value: "branded", label: "Branded prompts" },
] as const;
const ALL = "__all";

function Choice({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
    >
      <SelectTrigger aria-label={label} className="h-10 min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="w-max min-w-(--anchor-width) max-w-[min(24rem,var(--available-width))]">
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CompetitorFilter({
  brands,
  value,
  onChange,
}: {
  brands: AiVisibilityIntelligence["options"]["brands"];
  value: string[] | null;
  onChange: (value: string[] | null) => void;
}) {
  const rivals = brands.filter((b) => !b.own);
  const chosen = value ?? rivals.map((b) => b.domain);
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Choose competitors to compare"
        render={<Button variant="outline" className="h-10 gap-2 px-3" />}
      >
        {value === null ? "All competitors" : `${chosen.length} competitor(s)`}
        <ChevronDown className="size-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2">
        <p className="text-xs text-muted-foreground">
          Your brand is always compared. Share of voice and rank use the brands
          chosen here.
        </p>
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {rivals.map((brand) => {
            const checked = chosen.includes(brand.domain);
            return (
              <li key={brand.domain}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(next) => {
                      const list = next
                        ? [...chosen, brand.domain]
                        : chosen.filter((d) => d !== brand.domain);
                      onChange(list.length === rivals.length ? null : list);
                    }}
                  />
                  <span className="truncate">{brand.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
        {value !== null ? (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            <Check className="size-3.5" /> Compare all
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

type IntentOption = AiPromptIntent | "unknown";
const intentLabel = (intent: IntentOption) =>
  intent === "unknown" ? "Unknown intent" : AI_PROMPT_INTENT_LABELS[intent];

function IntentFilter({
  intents,
  value,
  onChange,
}: {
  intents: IntentOption[];
  value: IntentOption[] | null;
  onChange: (value: IntentOption[] | null) => void;
}) {
  const chosen = value ?? intents;
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Filter by buyer intent"
        render={<Button variant="outline" className="h-10 gap-2 px-3" />}
      >
        {value === null
          ? "All intents"
          : value.length === 1
            ? intentLabel(value[0])
            : `${value.length} intents`}
        <ChevronDown className="size-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2">
        <p className="text-xs text-muted-foreground">
          Intent is set per prompt when you edit it. Prompts without one are
          Unknown.
        </p>
        <ul className="space-y-1">
          {intents.map((intent) => (
            <li key={intent}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                <Checkbox
                  checked={chosen.includes(intent)}
                  onCheckedChange={(next) => {
                    const list = next
                      ? [...chosen, intent]
                      : chosen.filter((i) => i !== intent);
                    onChange(list.length === intents.length ? null : list);
                  }}
                />
                {intentLabel(intent)}
              </label>
            </li>
          ))}
        </ul>
        {value !== null ? (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            <Check className="size-3.5" /> All intents
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function InsightsFiltersBar({
  data,
  filters,
  onChange,
}: {
  data: AiVisibilityIntelligence | undefined;
  filters: InsightsFilters;
  onChange: (patch: Partial<InsightsFilters>) => void;
}) {
  const versions = data?.promptSet.versions ?? [];
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Filters"
    >
      <Choice
        label="Measurement period"
        items={PERIODS}
        value={String(filters.days)}
        onChange={(v) => {
          const period = PERIODS.find((p) => p.value === v);
          if (period) onChange({ days: period.days });
        }}
      />
      {data && data.options.engines.length > 1 ? (
        <EngineFilter
          label="Filter by engine"
          engines={data.options.engines}
          value={filters.engines ?? data.options.engines}
          onChange={(next) =>
            onChange({
              engines:
                next.length === data.options.engines.length ? null : next,
            })
          }
        />
      ) : null}
      {data && data.options.topics.length > 1 ? (
        <Choice
          label="Prompt group"
          items={[
            { value: ALL, label: "All prompt groups" },
            ...data.options.topics.map((t) => ({ value: t, label: t })),
          ]}
          value={filters.topic ?? ALL}
          onChange={(v) => onChange({ topic: v === ALL ? null : v })}
        />
      ) : null}
      {data && data.options.intents.length > 1 ? (
        <IntentFilter
          intents={data.options.intents}
          value={filters.intents}
          onChange={(intents) => onChange({ intents })}
        />
      ) : null}
      <Choice
        label="Prompt type"
        items={PROMPT_TYPES}
        value={filters.branded}
        onChange={(v) => {
          const type = PROMPT_TYPES.find((p) => p.value === v);
          if (type) onChange({ branded: type.value });
        }}
      />
      {data && data.options.brands.some((b) => !b.own) ? (
        <CompetitorFilter
          brands={data.options.brands}
          value={filters.competitors}
          onChange={(competitors) => onChange({ competitors })}
        />
      ) : null}
      {versions.length > 1 ? (
        <Choice
          label="Prompt set"
          items={versions.map((v) => ({
            value: v.id ?? "",
            label: `${v.version ? `Prompt set ${v.version}` : "Unversioned"} · ${v.runs} run(s)`,
          }))}
          value={data?.promptSet.selectedVersionId ?? ""}
          onChange={(v) => onChange({ promptSetVersionId: v || null })}
        />
      ) : null}
    </div>
  );
}
