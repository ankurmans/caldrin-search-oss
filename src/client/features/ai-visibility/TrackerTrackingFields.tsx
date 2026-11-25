import { cn } from "cn";
import { Info, TriangleAlert } from "lucide-react";
import { EngineLabel } from "./EngineLabel";
import { Checkbox } from "@/client/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import {
  AI_UNSUPPORTED_LOCATIONS,
  aiCountryLabel,
  type AiCapability,
  type AiEngine,
  type AiTrackerState,
} from "@/shared/ai-visibility";
import { PREMIUM_WALLET_ESTIMATES } from "@/shared/wallet-pricing";

export type TrackerDraft = {
  locationCode: number;
  languageCode: string;
  engines: AiEngine[];
  topic: { name: string; prompts: string[] };
};

export const MAX_PROMPTS_PER_ADDITION = 5;

export function TrackerTrackingFields({
  state,
  value,
  onChange,
  disabled,
}: {
  state: AiTrackerState;
  value: TrackerDraft;
  onChange: (value: TrackerDraft) => void;
  // Base UI checkboxes aren't native inputs, so a disabled <fieldset> misses them.
  disabled: boolean;
}) {
  const country = aiCountryLabel(value.locationCode);
  const engineGroup = (
    title: string,
    help: string,
    capabilities: AiCapability[],
  ) => (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`About ${title.toLowerCase()}`}
                className="text-muted-foreground"
              />
            }
          >
            <Info className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent>{help}</TooltipContent>
        </Tooltip>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {capabilities.map((capability) => {
          const unavailable = AI_UNSUPPORTED_LOCATIONS[
            capability.engine
          ].includes(value.locationCode);
          return (
            <Tooltip key={capability.engine} disabled={!unavailable}>
              <TooltipTrigger
                render={
                  <label
                    className={cn(
                      "flex items-center gap-3 rounded-lg border p-3 border-border",
                      unavailable
                        ? "cursor-not-allowed opacity-50"
                        : "cursor-pointer",
                    )}
                  />
                }
              >
                <Checkbox
                  checked={value.engines.includes(capability.engine)}
                  disabled={disabled || unavailable}
                  onCheckedChange={(checked) =>
                    onChange({
                      ...value,
                      engines: checked
                        ? [...value.engines, capability.engine]
                        : value.engines.filter(
                            (engine) => engine !== capability.engine,
                          ),
                    })
                  }
                />
                <span className="min-w-0 text-sm font-medium">
                  <EngineLabel
                    engine={capability.engine}
                    label={capability.label}
                  />
                  {capability.modelApi &&
                    (capability.engine === "claude" ||
                      capability.engine === "perplexity") && (
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        Wallet · {PREMIUM_WALLET_ESTIMATES[capability.engine]}{" "}
                        credits per answer
                      </span>
                    )}
                </span>
                {unavailable && (
                  <TriangleAlert className="ml-auto size-4 text-muted-foreground" />
                )}
              </TooltipTrigger>
              <TooltipContent>
                {capability.label} can't collect answers in {country}.
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
  return (
    <section className="space-y-5">
      {engineGroup(
        "Scraped responses",
        "Answers as users see them in each AI app.",
        state.capabilities.filter((capability) => !capability.modelApi),
      )}
      {engineGroup(
        "API responses",
        "Answers from each model's API, with web search.",
        state.capabilities.filter((capability) => capability.modelApi),
      )}
    </section>
  );
}
