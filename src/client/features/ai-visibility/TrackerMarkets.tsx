import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { ProjectMarketFields } from "@/client/features/projects/ProjectMarketFields";
import type { ProjectMarket } from "@/client/features/projects/types";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { setAiVisibilityMarkets } from "@/serverFunctions/ai-visibility";
import {
  aiEnginesWithoutLocation,
  aiMarketLabel,
  type AiTrackerState,
} from "@/shared/ai-visibility";
import { LOCATION_OPTIONS } from "@/shared/keyword-locations";

/**
 * Keep main market and additional market editing in the same section.
 */
export function TrackerMarkets({
  projectId,
  state,
  main,
  onMainChange,
  onSaved,
}: {
  projectId: string;
  state: AiTrackerState;
  main: ProjectMarket;
  onMainChange: (market: ProjectMarket) => void;
  onSaved: (state: AiTrackerState) => void;
}) {
  const [editor, setEditor] = useState<"main" | ProjectMarket | null>(null);
  const save = useMutation({
    mutationFn: (markets: AiTrackerState["markets"]) =>
      setAiVisibilityMarkets({ data: { projectId, markets } }),
    onSuccess: (next) => {
      onSaved(next);
      setEditor(null);
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const { tracker, markets } = state;
  const adding = editor === "main" ? null : editor;
  const alreadyTracked = (market: ProjectMarket) =>
    [main, ...(tracker ? [tracker] : []), ...markets].some(
      (saved) =>
        saved.locationCode === market.locationCode &&
        saved.languageCode === market.languageCode,
    );
  const supported = (market: ProjectMarket) =>
    aiEnginesWithoutLocation(state.engines, market.locationCode).length === 0;
  const suggestedMarket = [
    { locationCode: 2826, languageCode: "en" },
    ...LOCATION_OPTIONS.map(({ code, languageCode }) => ({
      locationCode: code,
      languageCode,
    })),
  ].find((market) => !alreadyTracked(market) && supported(market));
  const addError = adding
    ? alreadyTracked(adding)
      ? "This market is already tracked."
      : !supported(adding)
        ? "Some active engines can’t collect answers in this market."
        : null
    : null;
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Markets</h3>
      <div className="space-y-3 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-medium">Main market</h4>
            <p className="text-sm text-muted-foreground">
              {aiMarketLabel(main)}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={save.isPending}
            onClick={() => setEditor(editor === "main" ? null : "main")}
          >
            {editor === "main" ? "Done" : "Edit main market"}
          </Button>
        </div>
        {editor === "main" && (
          <>
            <ProjectMarketFields value={main} onChange={onMainChange} />
            <p className="text-xs text-muted-foreground">
              Use Review changes to save the main market.
            </p>
          </>
        )}
      </div>
      {markets.length > 0 && (
        <ul className="space-y-2" aria-label="Additional markets">
          {markets.map((market) => (
            <li
              key={`${market.locationCode}:${market.languageCode}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
            >
              {aiMarketLabel(market)}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Remove ${aiMarketLabel(market)}`}
                disabled={save.isPending}
                onClick={() =>
                  save.mutate(
                    markets.filter(
                      (m) =>
                        m.locationCode !== market.locationCode ||
                        m.languageCode !== market.languageCode,
                    ),
                  )
                }
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <h4 className="text-sm font-medium">New additional market</h4>
          <p className="text-xs text-muted-foreground">
            Each additional market collects the same prompts in a separate
            check.
          </p>
          <ProjectMarketFields value={adding} onChange={setEditor} />
          {addError && (
            <p role="status" className="text-xs text-muted-foreground">
              {addError}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={save.isPending || Boolean(addError)}
              onClick={() => save.mutate([...markets, adding])}
            >
              Add market
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={save.isPending}
              onClick={() => setEditor(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        tracker &&
        markets.length < 4 &&
        suggestedMarket && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={save.isPending}
            onClick={() => setEditor(suggestedMarket)}
          >
            <Plus />
            Add additional market
          </Button>
        )
      )}
    </section>
  );
}
