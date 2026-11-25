import type { buildChatAgentModel } from "@/server/lib/openrouter";
import type { ClaimItem, ClaimJob } from "./claimJobRepository";

// Hosted answer funding does not exist here, so no claim runs on a deployment
// model or holds credits.
export async function hostedClaimModel(_organizationId: string): Promise<{
  provider: string;
  model: ReturnType<typeof buildChatAgentModel>;
  rate: number;
} | null> {
  return null;
}

export async function reserveClaimWallet(job: ClaimJob, pending: number) {
  return job.creditsPerAnswer === 0 || pending === 0;
}

export async function settleClaimWallet(
  _job: ClaimJob,
  _items: ClaimItem[],
): Promise<void> {}

export async function releaseOrphanClaimHolds(): Promise<void> {}
