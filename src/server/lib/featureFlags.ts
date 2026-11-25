import { env } from "cloudflare:workers";

/**
 * Every feature flag the server reads, through isFeatureFlagOn. Each is a
 * global boolean in a Flagship app bound as FLAGS, so it can change without a
 * deploy. Off is the normal state, and a flag reads off whenever Flagship can't
 * answer or isn't bound, so nothing may depend on one being on.
 */
export enum FeatureFlag {
  // Stops the cron starting scheduled rank checks during a DataForSEO outage.
  // Rank tracking pages warn paid users with a scheduled tracker while it's on.
  PauseScheduledRankChecks = "pause-scheduled-rank-checks",
}

/** Whether a feature flag is on. Reads off when FLAGS isn't bound. */
export async function isFeatureFlagOn(flag: FeatureFlag): Promise<boolean> {
  if (!env.FLAGS) return false;
  return env.FLAGS.getBooleanValue(flag, false);
}
