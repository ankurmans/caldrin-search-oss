import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { intentLabel } from "@/client/features/domain/components/KeywordIntentBadge";
import {
  KEYWORD_CHANGES,
  KEYWORD_INTENTS,
  type DomainSearchParams,
} from "@/types/schemas/domain";

const ANY = "any";

const INTENT_ITEMS = [
  { value: ANY, label: "Any intent" },
  ...KEYWORD_INTENTS.map((value) => ({ value, label: intentLabel(value) })),
];

const CHANGE_LABELS = { new: "New", up: "Rising", down: "Declining" } as const;
const CHANGE_ITEMS = [
  { value: ANY, label: "Any change" },
  ...KEYWORD_CHANGES.map((value) => ({ value, label: CHANGE_LABELS[value] })),
];

type Props = {
  intent: DomainSearchParams["intent"];
  change: DomainSearchParams["change"];
  onIntentChange: (intent: DomainSearchParams["intent"]) => void;
  onChangeChange: (change: DomainSearchParams["change"]) => void;
};

/** Provider-side filters; each active one uses a slot of the 8-condition budget. */
export function KeywordQuickFilters({
  intent,
  change,
  onIntentChange,
  onChangeChange,
}: Props) {
  return (
    <div className="flex items-center gap-2">
      <Select
        items={INTENT_ITEMS}
        value={intent ?? ANY}
        onValueChange={(value) =>
          onIntentChange(KEYWORD_INTENTS.find((i) => i === value))
        }
      >
        <SelectTrigger aria-label="Filter by intent" className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INTENT_ITEMS.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        items={CHANGE_ITEMS}
        value={change ?? ANY}
        onValueChange={(value) =>
          onChangeChange(KEYWORD_CHANGES.find((c) => c === value))
        }
      >
        <SelectTrigger aria-label="Filter by rank change" className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CHANGE_ITEMS.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
