import { useQuery } from "@tanstack/react-query";
import { getUsageDisplay } from "@/serverFunctions/spend";

export const usageDisplayKey = ["usageDisplay"] as const;

function formatCost(value: number) {
  return `$${value.toFixed(value !== 0 && Math.abs(value) < 1 ? 4 : 2)}`;
}

/**
 * Whether this workspace is shown provider charges. Only a workspace on its own
 * provider keys pays the provider, so only it sees a price before a paid run;
 * everyone else still confirms the run, without the provider's price. Until
 * the answer arrives no price is shown, and if it cannot be read the price is
 * shown, so a failed read never hides a charge from someone who pays it.
 */
export function useCostDisplay() {
  const query = useQuery({
    queryKey: usageDisplayKey,
    queryFn: () => getUsageDisplay(),
    staleTime: 5 * 60_000,
  });
  const showCosts = query.data ? query.data.showProviderCosts : query.isError;
  return {
    display: query.data ?? null,
    showCosts,
    /** "$0.05" when charges are shown, otherwise null. */
    cost: (value: number | null | undefined) =>
      showCosts && value !== null && value !== undefined
        ? formatCost(value)
        : null,
  };
}
