import { useState } from "react";
import { aiMarketLabel } from "@/shared/ai-visibility";
import { Input } from "@/client/components/ui/input";
import { Button } from "@/client/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { aiEngineSchema } from "@/types/schemas/ai-visibility";
import {
  engineLabel,
  type SourceFilters,
} from "@/types/schemas/source-intelligence";
import type { SourceData } from "./sourceIntelligence";

const DAYS = [7, 28, 90, 365] as const;
const ANY = "any";
const LINKED_ENGINES = "linked";

export function sourceHasFilters(filters: SourceFilters) {
  return Boolean(
    filters.ownership ||
    filters.promptId ||
    filters.locationCode ||
    filters.engine ||
    filters.engines?.length ||
    filters.promptGroup ||
    filters.brandDomain ||
    filters.sourceDomain,
  );
}

export function SourceFilterBar({
  filters,
  data,
  onChange: change,
}: {
  filters: SourceFilters;
  data: SourceData | undefined;
  onChange: (filters: Partial<SourceFilters>) => void;
}) {
  const [domainDraft, setDomainDraft] = useState(filters.sourceDomain ?? "");
  const filtered = sourceHasFilters(filters);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        items={DAYS.map((d) => ({ value: String(d), label: `Last ${d} days` }))}
        value={String(filters.days)}
        onValueChange={(next) => {
          const days = DAYS.find((d) => String(d) === next);
          if (days) change({ days });
        }}
      >
        <SelectTrigger size="sm" aria-label="Window">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DAYS.map((d) => (
            <SelectItem key={d} value={String(d)}>
              Last {d} days
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        items={[
          { value: ANY, label: "All engines" },
          ...(filters.engines?.length
            ? [
                {
                  value: LINKED_ENGINES,
                  label: filters.engines.map(engineLabel).join(", "),
                },
              ]
            : []),
          ...aiEngineSchema.options.map((engine) => ({
            value: engine,
            label: engineLabel(engine),
          })),
        ]}
        value={
          filters.engine ?? (filters.engines?.length ? LINKED_ENGINES : ANY)
        }
        onValueChange={(next) => {
          if (next !== LINKED_ENGINES)
            change({
              engine: aiEngineSchema.options.find((e) => e === next),
              engines: undefined,
            });
        }}
      >
        <SelectTrigger size="sm" aria-label="Engine">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>All engines</SelectItem>
          {filters.engines?.length ? (
            <SelectItem value={LINKED_ENGINES}>
              {filters.engines.map(engineLabel).join(", ")}
            </SelectItem>
          ) : null}
          {aiEngineSchema.options.map((engine) => (
            <SelectItem key={engine} value={engine}>
              {engineLabel(engine)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        items={[
          { value: ANY, label: "All prompt groups" },
          ...(data?.promptGroups ?? []).map((g) => ({ value: g, label: g })),
        ]}
        value={filters.promptGroup ?? ANY}
        onValueChange={(next) =>
          change({ promptGroup: data?.promptGroups.find((g) => g === next) })
        }
      >
        <SelectTrigger size="sm" aria-label="Prompt group">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>All prompt groups</SelectItem>
          {(data?.promptGroups ?? []).map((g) => (
            <SelectItem key={g} value={g}>
              {g}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        items={[
          { value: ANY, label: "Any brand" },
          ...(data?.brands ?? []).map((b) => ({
            value: b.domain,
            label: b.name,
          })),
        ]}
        value={filters.brandDomain ?? ANY}
        onValueChange={(next) =>
          change({
            brandDomain: data?.brands.find((b) => b.domain === next)?.domain,
          })
        }
      >
        <SelectTrigger size="sm" aria-label="Competitor in the answer">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any brand</SelectItem>
          {(data?.brands ?? []).map((b) => (
            <SelectItem key={b.domain} value={b.domain}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <select
        aria-label="Market"
        className="h-8 rounded-md border bg-background px-2 text-sm"
        value={
          filters.locationCode
            ? `${filters.locationCode}:${filters.languageCode ?? ""}`
            : ANY
        }
        onChange={(event) => {
          const market = data?.markets.find(
            (item) =>
              `${item.locationCode}:${item.languageCode}` ===
              event.target.value,
          );
          change({
            locationCode: market?.locationCode,
            languageCode: market?.languageCode,
          });
        }}
      >
        <option value={ANY}>All markets</option>
        {(data?.markets ?? []).map((market) => (
          <option
            key={`${market.locationCode}:${market.languageCode}`}
            value={`${market.locationCode}:${market.languageCode}`}
          >
            {aiMarketLabel(market)}
          </option>
        ))}
      </select>
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          change({ sourceDomain: domainDraft.trim() || undefined });
        }}
      >
        <Input
          value={domainDraft}
          onChange={(event) => setDomainDraft(event.target.value)}
          placeholder="Source domain"
          aria-label="Source domain"
          className="h-8 w-40"
        />
      </form>
      {filtered ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDomainDraft("");
            change({
              ownership: undefined,
              promptId: undefined,
              locationCode: undefined,
              languageCode: undefined,
              engine: undefined,
              engines: undefined,
              promptGroup: undefined,
              brandDomain: undefined,
              sourceDomain: undefined,
            });
          }}
        >
          Clear
        </Button>
      ) : null}
    </div>
  );
}
