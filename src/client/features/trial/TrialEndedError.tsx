import { ErrorState } from "@/client/components/ErrorState";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { TrialEndedActions } from "./trialActions";

/**
 * The wall at the end of the free test run. A retry can't fix it, so there is
 * no retry button: the way on is the user's own keys or Cloud.
 */
export function TrialEndedError({
  variant,
  title,
}: {
  variant?: "inline" | "card" | "page";
  title?: string;
}) {
  return (
    <ErrorState
      variant={variant}
      title={title}
      message={getStandardErrorMessage(new Error("TRIAL_ENDED"))}
      action={<TrialEndedActions />}
    />
  );
}
