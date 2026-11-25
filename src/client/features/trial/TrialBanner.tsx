import { useQuery } from "@tanstack/react-query";
import { getTrialStatus } from "@/serverFunctions/trial";
import { AppBanner } from "@/client/layout/AppBanner";
import { TrialEndedActions } from "./trialActions";

const usd = (amount: number) => `$${amount.toFixed(2)}`;

/** Where the workspace stands on its free test run; nothing once it is over or never was. */
export function TrialBanner() {
  const { data } = useQuery({
    queryKey: ["trial-status"],
    queryFn: () => getTrialStatus(),
    staleTime: 60_000,
  });
  if (!data || data.phase === "none") return null;

  if (data.phase === "active") {
    const remaining = Math.max(0, data.budgetUsd - data.spentUsd);
    return (
      <AppBanner variant="info">
        Free test run: {usd(remaining)} of {usd(data.budgetUsd)} left. Add your
        own keys any time.
      </AppBanner>
    );
  }

  return (
    <AppBanner variant="warning">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          Your free test run is used. Add your keys or upgrade to Cloud.
        </span>
        <TrialEndedActions />
      </div>
    </AppBanner>
  );
}
