import type { AiEngine } from "@/shared/ai-visibility";
import { hasDataforseoAccess } from "@/server/lib/provider-access";
import {
  currentWorkspaceId,
  runInWorkspace,
} from "@/server/lib/workspace-scope";

export async function hasAiCollectionAccess(
  organizationId = currentWorkspaceId(),
) {
  return organizationId
    ? runInWorkspace(organizationId, hasDataforseoAccess)
    : false;
}

type WalletRun = {
  runId: string;
  organizationId: string;
  reserved: number;
  charged: number | null;
  standardRate: number;
  claudeRate: number;
  perplexityRate: number;
  includedReserved: number;
  expiresAt: string;
};

// This installation has no hosted wallet: nothing is funded, held or charged.
export async function walletAccount(_organizationId: string) {
  return {
    enabled: false,
    available: 0,
    purchasedAvailable: 0,
    includedAvailable: 0,
    includedTotal: 0,
    includedExpiresAt: null as string | null,
    held: 0,
  };
}

export async function walletRunReservation(
  _runId: string,
): Promise<WalletRun | undefined> {
  return undefined;
}

export async function expiredWalletRuns(): Promise<{ runId: string }[]> {
  return [];
}

export async function reserveAiWallet(_input: {
  runId: string;
  organizationId: string;
  engines: AiEngine[];
  mode: "live" | "queued";
}): Promise<never> {
  throw new Error("Hosted funding is unavailable in this installation.");
}

export async function settleAiWallet(
  _runId: string,
  _completed: AiEngine[],
): Promise<void> {}
