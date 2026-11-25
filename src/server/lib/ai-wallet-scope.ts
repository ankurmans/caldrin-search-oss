import { AsyncLocalStorage } from "node:async_hooks";

const funding = new AsyncLocalStorage<{
  organizationId: string;
  expiresAt: string;
}>();

/** For answer collection callbacks backed by a server-verified reservation. */
export function withAiWallet<T>(
  reservation: { organizationId: string; expiresAt: string },
  fn: () => T,
): T {
  return funding.run(reservation, fn);
}

export function usesAiWallet(organizationId: string) {
  const reservation = funding.getStore();
  return reservation?.organizationId === organizationId;
}

export function assertAiWalletProviderAccess(
  organizationId: string | null,
  provider: string,
) {
  if (!organizationId || !usesAiWallet(organizationId)) return false;
  const reservation = funding.getStore();
  if (!reservation || reservation.expiresAt <= new Date().toISOString())
    throw new Error("The AI check's wallet reservation expired.");
  if (
    provider === "dataforseo" ||
    provider === "anthropic" ||
    provider === "perplexity"
  )
    return true;
  throw new Error("This provider cannot use the AI tracking wallet.");
}
