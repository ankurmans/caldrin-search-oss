import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getLanguageCode,
  LABS_LOCATION_OPTIONS,
  LOCATIONS,
} from "@/shared/keyword-locations";
import { setCompetitorMarkets } from "@/serverFunctions/site-explorer";
import { gapKeys } from "./gap";

const MARKET_ITEMS = LABS_LOCATION_OPTIONS.map((option) => ({
  value: String(option.code),
  label: option.shortLabel,
}));

type Market = { locationCode: number; languageCode: string };

export function MarketEditor({
  projectId,
  domain,
  markets,
}: {
  projectId: string;
  domain: string;
  markets: Market[];
}) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (next: Market[]) =>
      setCompetitorMarkets({ data: { projectId, domain, markets: next } }),
    onSuccess: (result) => {
      if (!result.ok) return void toast.error(result.reason);
      void queryClient.invalidateQueries({
        queryKey: gapKeys.competitors(projectId),
      });
    },
    onError: (error) => toast.error(getStandardErrorMessage(error, "Failed")),
  });

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {markets.length === 0 ? (
        <span className="text-xs text-muted-foreground">Project market</span>
      ) : (
        markets.map((market) => (
          <Badge
            key={`${market.locationCode}-${market.languageCode}`}
            variant="outline"
          >
            {LOCATIONS[market.locationCode] ?? market.locationCode} ·{" "}
            {market.languageCode.toUpperCase()}
            <button
              type="button"
              aria-label={`Remove ${LOCATIONS[market.locationCode] ?? market.locationCode} market from ${domain}`}
              onClick={() =>
                save.mutate(
                  markets.filter(
                    (item) =>
                      !(
                        item.locationCode === market.locationCode &&
                        item.languageCode === market.languageCode
                      ),
                  ),
                )
              }
            >
              <X />
            </button>
          </Badge>
        ))
      )}
      <Select
        items={MARKET_ITEMS}
        value=""
        onValueChange={(next) => {
          const locationCode = Number(next);
          if (!Number.isInteger(locationCode)) return;
          const languageCode = getLanguageCode(locationCode);
          if (
            markets.some(
              (item) =>
                item.locationCode === locationCode &&
                item.languageCode === languageCode,
            )
          )
            return;
          save.mutate([...markets, { locationCode, languageCode }]);
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label={`Add a market for ${domain}`}
          className="w-36"
        >
          <SelectValue placeholder="Add market" />
        </SelectTrigger>
        <SelectContent>
          {MARKET_ITEMS.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
