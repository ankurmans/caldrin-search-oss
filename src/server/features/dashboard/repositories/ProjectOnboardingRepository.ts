import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  aiRuns,
  attributionProperties,
  changeLedgerEntries,
  projectActivationState,
  projectFirstReadFindings,
  projectFirstReads,
  projects,
  rankTrackingConfigs,
  shopifyConnections,
} from "@/db/schema";
import type { OnboardingPreference } from "@/shared/onboarding";

async function readMilestones(projectId: string, domain: string | null) {
  const [row] = await db
    .select({
      rankTracker: exists(
        db
          .select({ id: rankTrackingConfigs.id })
          .from(rankTrackingConfigs)
          .where(
            and(
              eq(rankTrackingConfigs.projectId, projectId),
              domain ? eq(rankTrackingConfigs.domain, domain) : undefined,
            ),
          ),
      ),
      baseline:
        or(
          exists(
            db
              .select({ id: aiRuns.id })
              .from(aiRuns)
              .where(
                and(
                  eq(aiRuns.projectId, projectId),
                  inArray(aiRuns.status, ["completed", "partial"]),
                ),
              ),
          ),
          exists(
            db
              .select({ rank: projectFirstReadFindings.rank })
              .from(projectFirstReadFindings)
              .innerJoin(
                projectFirstReads,
                eq(projectFirstReads.key, projectFirstReadFindings.readKey),
              )
              .where(
                and(
                  eq(projectFirstReads.projectId, projectId),
                  eq(projectFirstReadFindings.kind, "ai_citations"),
                ),
              ),
          ),
        ) ?? sql`false`,
      connector:
        or(
          exists(
            db
              .select({ id: shopifyConnections.id })
              .from(shopifyConnections)
              .where(
                and(
                  eq(shopifyConnections.projectId, projectId),
                  eq(shopifyConnections.mode, "live"),
                ),
              ),
          ),
          exists(
            db
              .select({ id: changeLedgerEntries.id })
              .from(changeLedgerEntries)
              .where(
                and(
                  eq(changeLedgerEntries.projectId, projectId),
                  eq(changeLedgerEntries.provider, "google_tag_manager"),
                  eq(changeLedgerEntries.status, "executed"),
                  eq(changeLedgerEntries.publicationStatus, "published"),
                ),
              ),
          ),
        ) ?? sql`false`,
      tracker: exists(
        db
          .select({ id: attributionProperties.id })
          .from(attributionProperties)
          .where(
            and(
              eq(attributionProperties.projectId, projectId),
              isNotNull(attributionProperties.verifiedAt),
            ),
          ),
      ),
    })
    .from(projects)
    .where(eq(projects.id, projectId));
  return {
    rankTracker: Boolean(row?.rankTracker),
    baseline: Boolean(row?.baseline),
    connector: Boolean(row?.connector),
    tracker: Boolean(row?.tracker),
  };
}

async function setGoal(projectId: string, goal: OnboardingPreference) {
  const updatedAt = new Date().toISOString();
  await db
    .insert(projectActivationState)
    .values({ projectId, goal, updatedAt })
    .onConflictDoUpdate({
      target: projectActivationState.projectId,
      set: { goal, updatedAt },
    });
}

async function markFirstReadEngagement(
  projectId: string,
  milestone: "firstReadViewedAt" | "firstFindingOpenedAt",
) {
  // A first read must have stored findings. Starting the request or landing
  // on the dashboard isn't sufficient to complete the checklist step.
  const [read] = await db
    .select({ rank: projectFirstReadFindings.rank })
    .from(projectFirstReadFindings)
    .innerJoin(
      projectFirstReads,
      eq(projectFirstReads.key, projectFirstReadFindings.readKey),
    )
    .where(eq(projectFirstReads.projectId, projectId))
    .limit(1);
  if (!read) return false;
  const updatedAt = new Date().toISOString();
  const [changed] = await db
    .insert(projectActivationState)
    .values({ projectId, [milestone]: updatedAt, updatedAt })
    .onConflictDoUpdate({
      target: projectActivationState.projectId,
      set: { [milestone]: updatedAt, updatedAt },
      setWhere: isNull(projectActivationState[milestone]),
    })
    .returning({ id: projectActivationState.projectId });
  return Boolean(changed);
}

export const ProjectOnboardingRepository = {
  readMilestones,
  setGoal,
  markFirstReadEngagement,
};
