import { describeFailure } from "../rules/describeFailure";
import { ProviderHealthRepository } from "../repositories/ProviderHealthRepository";
import { runProviderCanary } from "./providerCanary";

const RETENTION_DAYS = 90;
const CANARY_EVERY_DAYS = 6;
const DAY_MS = 86_400_000;

const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

/**
 * Keeps the cause of a provider failure that a service caught and turned into
 * a refusal. Best effort: recording never changes what the caller does, and a
 * failure to record is only logged.
 */
async function recordFailure(
  operation: string,
  error: unknown,
  scope?: { organizationId: string; projectId: string },
) {
  try {
    const failure = describeFailure(error);
    await ProviderHealthRepository.insert({
      createdAt: new Date().toISOString(),
      provider: "dataforseo",
      operation,
      source: "service",
      ok: false,
      kind: failure.kind,
      httpStatus: failure.httpStatus,
      message: failure.message,
      organizationId: scope?.organizationId ?? null,
      projectId: scope?.projectId ?? null,
    });
  } catch (recordError) {
    console.error("[provider-health] could not record", recordError);
  }
}

/**
 * The daily cron calls this. It runs the canary at most every six days,
 * reports any failed check as an error log line (Workers Observability), and
 * drops events older than the retention window.
 */
async function runScheduled() {
  const last = await ProviderHealthRepository.lastCanaryAt();
  let canary: Awaited<ReturnType<typeof runProviderCanary>> | null = null;
  if (!last || last < isoAgo(CANARY_EVERY_DAYS * DAY_MS)) {
    canary = await runProviderCanary();
    for (const check of canary.checks.filter((entry) => !entry.ok)) {
      console.error("[provider-canary] FAILED", JSON.stringify(check));
    }
  }
  await ProviderHealthRepository.pruneBefore(isoAgo(RETENTION_DAYS * DAY_MS));
  return {
    canaryRan: canary !== null,
    failed: canary?.checks.filter((entry) => !entry.ok).length ?? 0,
  };
}

export const ProviderHealthService = {
  recordFailure,
  runScheduled,
  recent: ProviderHealthRepository.recent,
};
