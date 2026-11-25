import { env } from "cloudflare:workers";
import { getAuthMode } from "@/lib/auth-mode";
import { SHARED_WORKSPACE_ORGANIZATION_ID } from "@/server/auth/delegated-organization";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { getAllowedProjectIds } from "@/server/auth/project-access";
import { hasOrgPermission } from "@/lib/org-permissions";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import {
  SpendService,
  SpendLimitRefusal,
} from "@/server/features/spend/services/SpendService";
import { canQueueRefresh } from "@/shared/refreshQueue";
import {
  isWorkflowActive,
  readWorkflowStatus,
  startWorkflow,
} from "@/server/lib/startWorkflow";
import { runInWorkspace } from "@/server/lib/workspace-scope";
import { ContentRepository } from "../repositories/ContentRepository";
import { ContentRefreshRepository as repo } from "../repositories/ContentRefreshRepository";
import { ContentRefusal } from "../rules/contentRefusal";
import type { Scope } from "./shopifyConnection";
import { writeOpportunityRefresh } from "./contentRefresh";

function startBatch(batchId: string) {
  return startWorkflow(
    env.AI_VISIBILITY_WORKFLOW,
    {
      id: batchId,
      params: { contentRefreshBatchId: batchId },
    },
    "Content refresh",
  ).catch((error) => {
    // A persisted batch can be dispatched again by the watchdog.
    console.error("[content-refresh] Batch dispatch failed", batchId, error);
  });
}

async function checkBudget(scope: Scope, count: number) {
  await SpendService.assertWithinLimits(scope, {
    estimatedUsd: SpendService.estimateLlmDraftUsd().estimatedUsd * count,
    provider: "llm",
    operation: "content_refresh",
  });
}

export async function queueContentRefresh(
  scope: Scope,
  opportunityIds: string[],
) {
  const ids = [...new Set(opportunityIds)];
  const candidates = await Promise.all(
    ids.map((id) => ContentRepository.getOpportunity(scope.projectId, id)),
  );
  if (candidates.some((row) => !row || !canQueueRefresh(row)))
    throw new ContentRefusal("Choose open opportunities for existing pages.");
  await checkBudget(scope, ids.length);
  const batchId = `content-refresh-${crypto.randomUUID()}`;
  const added = await repo.insert(scope.projectId, batchId, scope.userId, ids);
  if (added.length) await startBatch(batchId);
  return { queued: added.length };
}

export async function retryContentRefresh(scope: Scope, id: string) {
  await checkBudget(scope, 1);
  const batchId = `content-refresh-${crypto.randomUUID()}`;
  if (!(await repo.retry(scope.projectId, id, batchId, scope.userId)))
    throw new ContentRefusal("Only a failed refresh can be retried.");
  await startBatch(batchId);
}

export const listContentRefresh = repo.list;
export const listContentRefreshBatch = repo.batchJobs;
export const interruptContentRefresh = repo.interruptedBatch;

async function canRunRefresh(
  userId: string,
  organizationId: string,
  projectId: string,
  role?: string,
) {
  const mode = getAuthMode(env.AUTH_MODE);
  if (mode === "local_noauth") return organizationId === `delegated-${userId}`;
  if (mode === "cloudflare_access")
    return organizationId === SHARED_WORKSPACE_ORGANIZATION_ID;
  if (!role || !hasOrgPermission(role, { integration: ["manage"] }))
    return false;
  const allowed = await getAllowedProjectIds(userId, organizationId, role);
  return allowed === null || allowed.includes(projectId);
}

export async function executeContentRefresh(batchId: string, id: string) {
  const job = await repo.claim(batchId, id);
  if (!job) return;
  try {
    const project = await ProjectRepository.getProjectById(job.projectId);
    if (!project) throw new ContentRefusal("This project is no longer open.");
    const [membership, user] = await Promise.all([
      AuthRepository.getMembership(job.requestedBy, project.organizationId),
      AuthRepository.getUser(job.requestedBy),
    ]);
    if (
      !user ||
      !(await canRunRefresh(
        user.id,
        project.organizationId,
        project.id,
        membership?.role,
      ))
    )
      throw new ContentRefusal(
        "The requester can no longer edit this project.",
      );
    const result = await runInWorkspace(project.organizationId, () =>
      writeOpportunityRefresh(
        {
          projectId: project.id,
          organizationId: project.organizationId,
          userId: user.id,
          userEmail: user.email,
        },
        job.opportunityId,
        project,
        true,
      ),
    );
    await repo.finish(
      batchId,
      id,
      result.written ? "ready" : "failed",
      result.written ? null : result.reason,
    );
  } catch (error) {
    if (
      !(error instanceof ContentRefusal || error instanceof SpendLimitRefusal)
    )
      console.error("[content-refresh] Draft job failed", id, error);
    await repo.finish(
      batchId,
      id,
      "failed",
      error instanceof ContentRefusal || error instanceof SpendLimitRefusal
        ? error.message
        : "The draft could not be prepared. Open any imported copy or retry.",
    );
  }
}

export async function reconcileContentRefresh() {
  const stale = await repo.staleBatches(
    new Date(Date.now() - 10 * 60_000).toISOString(),
  );
  for (const { batchId } of stale) {
    const status = await readWorkflowStatus(
      env.AI_VISIBILITY_WORKFLOW,
      batchId,
    );
    if (status === "missing") await startBatch(batchId);
    else if (status && !isWorkflowActive(status))
      await repo.interruptedBatch(batchId);
  }
}
