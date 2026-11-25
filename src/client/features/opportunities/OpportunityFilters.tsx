import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  ACTION_LABELS,
  INTENT_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  type ActionKey,
  type IntentKey,
  type SourceKey,
  type StatusKey,
} from "./helpers";

export const ALL = "all";

export type Filters = {
  intent: IntentKey | typeof ALL;
  action: ActionKey | typeof ALL;
  status: StatusKey | typeof ALL;
  source: SourceKey | typeof ALL;
};

export const NO_FILTERS: Filters = {
  intent: ALL,
  action: ALL,
  status: ALL,
  source: ALL,
};

type Option<T extends string> = { value: T | typeof ALL; label: string };

function options<T extends string>(
  allLabel: string,
  labels: Record<T, string>,
): Option<T>[] {
  const entries: Option<T>[] = [];
  for (const value in labels) entries.push({ value, label: labels[value] });
  return [{ value: ALL, label: allLabel }, ...entries];
}

const STATUS_OPTIONS = options("Any status", STATUS_LABELS);
const ACTION_OPTIONS = options("Any action", ACTION_LABELS);
const INTENT_OPTIONS = options("Any intent", INTENT_LABELS);
const SOURCE_OPTIONS = options("Any source", SOURCE_LABELS);

function FilterSelect<T extends string>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: Option<T>[];
  value: T | typeof ALL;
  onChange: (next: T | typeof ALL) => void;
}) {
  return (
    <Select<T | typeof ALL>
      items={choices}
      value={value}
      onValueChange={(next) =>
        onChange(choices.find((choice) => choice.value === next)?.value ?? ALL)
      }
    >
      <SelectTrigger
        size="sm"
        className="w-full"
        aria-label={`Filter by ${label}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function OpportunityFilters({
  value,
  onChange,
}: {
  value: Filters;
  onChange: (next: Filters) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <FilterSelect
        label="status"
        choices={STATUS_OPTIONS}
        value={value.status}
        onChange={(status) => onChange({ ...value, status })}
      />
      <FilterSelect
        label="action"
        choices={ACTION_OPTIONS}
        value={value.action}
        onChange={(action) => onChange({ ...value, action })}
      />
      <FilterSelect
        label="intent"
        choices={INTENT_OPTIONS}
        value={value.intent}
        onChange={(intent) => onChange({ ...value, intent })}
      />
      <FilterSelect
        label="source"
        choices={SOURCE_OPTIONS}
        value={value.source}
        onChange={(source) => onChange({ ...value, source })}
      />
    </div>
  );
}
