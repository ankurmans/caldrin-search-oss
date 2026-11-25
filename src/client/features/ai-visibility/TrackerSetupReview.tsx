import { Link } from "@tanstack/react-router";
import { usesBetterAuthClient } from "@/lib/auth-mode";
import { Loader2 } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { DialogFooter } from "@/client/components/ui/dialog";
import { aiMarketLabel, type AiCostEstimate } from "@/shared/ai-visibility";
import { EngineLabel } from "./EngineLabel";
import type { AiTrackerPatch } from "@/types/schemas/ai-visibility";
import { useCostDisplay } from "@/client/features/spend/useCostDisplay";
import { AiQueryError, aiMoney } from "./shared";

export type TrackerSetupReviewData = {
  patch: AiTrackerPatch;
  estimate: AiCostEstimate;
};

export function TrackerSetupReview({
  review,
  enabled,
  creating,
  pending,
  error,
  canSchedule,
  scheduling,
  onBack,
  onSave,
  onSaveAndSchedule,
}: {
  review: TrackerSetupReviewData;
  enabled: boolean;
  /** No tracker yet; saving creates one on the weekly schedule. */
  creating: boolean;
  pending: boolean;
  error: unknown;
  canSchedule: boolean;
  scheduling: boolean;
  onBack: () => void;
  onSave: () => void;
  onSaveAndSchedule: () => void;
}) {
  const paused = !enabled && !creating;
  const { showCosts: showProviderCosts } = useCostDisplay();
  const showCosts = showProviderCosts && !review.estimate.wallet.enabled;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Review your changes before saving.{" "}
        {enabled
          ? "These settings apply to your enabled schedule."
          : creating
            ? "Tracking runs weekly. The first check is a week from now; use Run now for results sooner."
            : review.estimate.wallet.enabled
              ? "Your first wallet-funded check runs at the scheduled time. Use Run now to start sooner."
              : "Track weekly to collect fresh answers once a week. A tracker that has never run on a schedule also runs its first check now."}
      </p>
      <dl className="grid grid-cols-2 gap-4 rounded-lg border p-4 text-sm border-border">
        {review.patch.engines && (
          <div>
            <dt className="text-muted-foreground">Engines</dt>
            <dd className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {review.patch.engines?.map((engine) => (
                <EngineLabel key={engine} engine={engine} />
              ))}
            </dd>
          </div>
        )}
        {review.patch.prompts !== undefined && (
          <div>
            <dt className="text-muted-foreground">New prompts</dt>
            <dd className="mt-1">{review.patch.prompts?.length ?? 0}</dd>
          </div>
        )}
        {review.patch.prompts?.[0]?.topic && (
          <div>
            <dt className="text-muted-foreground">Topic</dt>
            <dd className="mt-1">{review.patch.prompts[0].topic}</dd>
          </div>
        )}
        {review.patch.locationCode && review.patch.languageCode && (
          <div>
            <dt className="text-muted-foreground">Market</dt>
            <dd className="mt-1">
              {aiMarketLabel({
                locationCode: review.patch.locationCode,
                languageCode: review.patch.languageCode,
              })}
            </dd>
          </div>
        )}
      </dl>
      {!!review.patch.prompts?.length && (
        <div
          className="max-h-56 space-y-2 overflow-y-auto rounded-lg border p-4 border-border"
          data-ph-mask
        >
          <h3 className="text-sm font-semibold">Prompts to add</h3>
          {review.patch.prompts.map((prompt) => (
            <p
              key={prompt.text}
              className="whitespace-pre-wrap text-[0.8125rem] leading-relaxed"
            >
              {prompt.text}
            </p>
          ))}
        </div>
      )}
      <div className="space-y-1 rounded-lg bg-muted/60 p-4 text-sm">
        <p>
          Each run collects <strong>{review.estimate.observations}</strong>{" "}
          {review.estimate.observations === 1 ? "answer" : "answers"}
          {showCosts && (
            <>
              {" "}
              for <strong>{aiMoney(review.estimate.costUsd)}</strong>
            </>
          )}
        </p>
        {showCosts ? (
          <p>
            <strong>{aiMoney(review.estimate.monthlyCostUsd)}</strong> estimated
            per month if it runs {review.estimate.scheduleInterval}.
          </p>
        ) : (
          <p>It runs {review.estimate.scheduleInterval} once scheduled.</p>
        )}
      </div>
      {(review.estimate.wallet.enabled ||
        review.patch.engines?.some(
          (engine) => engine === "claude" || engine === "perplexity",
        )) && (
        <div className="space-y-1 rounded-lg border border-border p-3 text-sm">
          <p className="font-medium">
            {review.patch.engines?.some(
              (engine) => engine === "claude" || engine === "perplexity",
            )
              ? "Premium engines are included in this setup"
              : "Wallet credits"}
          </p>
          <p className="text-muted-foreground">
            {review.estimate.wallet.enabled ? "" : "Wallet rates · "}
            {review.estimate.wallet.scheduledCredits.toLocaleString()} credits
            per scheduled run and about{" "}
            {review.estimate.wallet.monthlyCredits.toLocaleString()} per month.
            {review.estimate.wallet.enabled
              ? " Only completed answers are charged."
              : " Your current provider billing applies."}
            {usesBetterAuthClient() && (
              <>
                {" "}
                <Link to="/settings/billing" className="underline">
                  See billing
                </Link>
                .
              </>
            )}
          </p>
        </div>
      )}
      {!!error && <AiQueryError error={error} />}
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={onBack}
        >
          Back to editing
        </Button>
        <Button
          type="button"
          variant={paused ? "secondary" : "default"}
          disabled={pending}
          onClick={onSave}
        >
          {pending && !scheduling && (
            <Loader2 className="size-4 animate-spin" />
          )}
          {enabled
            ? "Save reviewed changes"
            : creating
              ? "Save and track weekly"
              : "Save as paused"}
        </Button>
        {paused && (
          <Button
            type="button"
            disabled={
              pending || !canSchedule || review.estimate.observations === 0
            }
            onClick={onSaveAndSchedule}
          >
            {pending && scheduling && (
              <Loader2 className="size-4 animate-spin" />
            )}
            Save and track weekly
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}
