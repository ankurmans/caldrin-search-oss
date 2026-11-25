import { captureClaimEvent } from "./claimAnalytics";
import {
  hostedClaimModel,
  settleClaimWallet,
} from "@/server/features/ai-claims/claimFunding";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { getAllowedProjectIds } from "@/server/auth/project-access";
import { AuditLogService } from "@/server/features/audit-log/services/AuditLogService";
import {
  getCredential,
  getWorkspaceMode,
} from "@/server/features/workspace/credentials";
import { hasOrgPermission, isClientGuest } from "@/lib/org-permissions";
import { AppError } from "@/server/lib/errors";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import {
  buildChatAgentModel,
  credentialToAccess,
} from "@/server/lib/openrouter";
import { isUniqueViolation } from "@/db/isUniqueViolation";
import { claimJobRepository as repo } from "./claimJobRepository";
import {
  CLAIM_RECIPE,
  MAX_ANSWERS,
  MAX_ANSWER_CHARS,
  hashClaimInput,
} from "./claimRules";

export type ClaimActor = {
  projectId: string;
  organizationId: string;
  userId: string;
  role: string;
};
export const claimsEnabled = async () =>
  (await getOptionalEnvValue("AI_CLAIMS_ENABLED")) === "true";

export async function claimsEnabledForWorkspace(organizationId: string) {
  if (!(await claimsEnabled())) return false;
  const allowlist = await getOptionalEnvValue("AI_CLAIMS_WORKSPACE_ALLOWLIST");
  return (
    allowlist === undefined ||
    allowlist.split(",").some((entry) => entry.trim() === organizationId)
  );
}

export const claimReviewer = (role: string) =>
  !isClientGuest(role) &&
  role.split(",").some((value) => ["owner", "admin"].includes(value.trim()));

export async function requireClaimsAccess(actor: ClaimActor) {
  if (
    !(await claimsEnabledForWorkspace(actor.organizationId)) ||
    isClientGuest(actor.role) ||
    !hasOrgPermission(actor.role, { integration: ["manage"] })
  )
    throw new AppError("FORBIDDEN", "Claim Intelligence is unavailable.");
  const projects = await getAllowedProjectIds(
    actor.userId,
    actor.organizationId,
    actor.role,
  );
  if (
    !(await ProjectRepository.getProjectForOrganization(
      actor.projectId,
      actor.organizationId,
    ))
  )
    throw new AppError("NOT_FOUND", "Project unavailable.");
  if (projects !== null && !projects.includes(actor.projectId))
    throw new AppError("FORBIDDEN", "Claim Intelligence is unavailable.");
}

export const recordClaimEvent = (
  actor: ClaimActor,
  id: string,
  summary: string,
) =>
  AuditLogService.record({
    organizationId: actor.organizationId,
    projectId: actor.projectId,
    actorUserId: actor.userId,
    action: "ai_claim_review",
    summary,
    targetKind: "claim_intelligence",
    targetId: id,
  });

export async function workspaceModel(organizationId: string) {
  if ((await getWorkspaceMode(organizationId, { fresh: true })) !== "byok")
    return null;
  const credential = await getCredential(organizationId, "llm", {
    fresh: true,
  });
  if (!credential) return null;
  const access = credentialToAccess(credential);
  return access === "missing"
    ? null
    : {
        model: buildChatAgentModel(access, undefined, "fast"),
        provider: credential.provider,
      };
}

export async function estimateClaimJob(
  actor: ClaimActor,
  runId: string,
  observationIds?: string[],
  funding: "byok" | "hosted" = "byok",
) {
  await requireClaimsAccess(actor);
  if (funding === "hosted" && !claimReviewer(actor.role))
    throw new AppError(
      "FORBIDDEN",
      "An owner or admin must approve hosted claim spend.",
    );
  const hosted =
    funding === "hosted" ? await hostedClaimModel(actor.organizationId) : null;
  const provider =
    funding === "hosted" ? hosted : await workspaceModel(actor.organizationId);
  if (!provider)
    throw new AppError(
      "VALIDATION_ERROR",
      funding === "hosted"
        ? "Hosted claim extraction is unavailable for this workspace."
        : "Add a workspace AI key to estimate claim extraction.",
    );
  const cutoff = new Date(Date.now() - 86_400_000).toISOString();
  if ((await repo.dailyJobs(actor.projectId, cutoff)) >= 12)
    throw new AppError(
      "VALIDATION_ERROR",
      "This project reached its daily extraction request limit.",
    );
  const id = crypto.randomUUID();
  const now = new Date();
  const job = {
    id,
    projectId: actor.projectId,
    workspaceId: actor.organizationId,
    actorId: actor.userId,
    runId,
    recipe: CLAIM_RECIPE,
    model: provider.model.modelId,
    provider: provider.provider,
    creditsPerAnswer: hosted?.rate ?? 0,
    billingError: null,
    status: "ready" as const,
    leaseUntil: null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
  };
  const answers = await repo.answers(actor.projectId, runId);
  if (
    observationIds?.some(
      (answerId) => !answers.some((answer) => answer.id === answerId),
    )
  )
    throw new AppError("NOT_FOUND", "A selected answer is unavailable.");
  const selected = observationIds
    ? answers.filter((answer) => observationIds.includes(answer.id))
    : answers;
  const eligible = selected.filter(
    (answer) =>
      answer.answer?.trim() && answer.answer.length <= MAX_ANSWER_CHARS,
  );
  const batch = eligible.slice(0, MAX_ANSWERS);
  const entries = await Promise.all(
    batch.map(async (answer) => {
      const inputHash = await hashClaimInput(answer.answer!);
      const cached = await repo.cached(job, answer.id, inputHash);
      return {
        id: crypto.randomUUID(),
        jobId: id,
        observationId: answer.id,
        inputHash,
        status:
          cached === "unknown" || cached === "dispatching"
            ? ("unknown" as const)
            : cached
              ? ("cached" as const)
              : ("pending" as const),
      };
    }),
  );
  if (!entries.length)
    throw new AppError(
      "VALIDATION_ERROR",
      "There are no eligible completed answers in this selection.",
    );
  await repo.estimate(job, entries);
  return {
    id,
    included: entries.length,
    excluded: selected.length - entries.length,
    calls: entries.filter((item) => item.status === "pending").length,
    expiresAt: job.expiresAt,
    model: job.model,
    credits:
      entries.filter((item) => item.status === "pending").length *
      job.creditsPerAnswer,
    funding,
  };
}

async function ownedJob(actor: ClaimActor, id: string) {
  await requireClaimsAccess(actor);
  const job = await repo.get(actor.projectId, id);
  if (
    !job ||
    job.actorId !== actor.userId ||
    job.workspaceId !== actor.organizationId
  )
    throw new AppError("NOT_FOUND", "Extraction job unavailable.");
  return job;
}

export async function startClaimJob(
  actor: ClaimActor,
  id: string,
  maxCalls: number,
) {
  const job = await ownedJob(actor, id);
  if (job.status !== "ready") return job.id;
  if (job.creditsPerAnswer && !claimReviewer(actor.role))
    throw new AppError(
      "FORBIDDEN",
      "An owner or admin must approve hosted claim spend.",
    );
  const hosted = job.creditsPerAnswer
    ? await hostedClaimModel(actor.organizationId)
    : null;
  const provider = job.creditsPerAnswer
    ? hosted
    : await workspaceModel(actor.organizationId);
  if (
    !provider ||
    (hosted && hosted.rate !== job.creditsPerAnswer) ||
    provider.provider !== job.provider ||
    provider.model.modelId !== job.model ||
    (await repo.items(job.id)).filter((item) => item.status === "pending")
      .length > maxCalls
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "Review a fresh extraction estimate.",
    );
  try {
    const queued = await repo.queue(job, new Date().toISOString());
    if (queued.length) {
      await recordClaimEvent(actor, id, "Confirmed a bounded claim extraction");
      await captureClaimEvent(actor, "analysis_started");
    } else if ((await repo.get(actor.projectId, id))?.status === "ready")
      throw new AppError(
        "VALIDATION_ERROR",
        "This estimate expired. Request a new estimate.",
      );
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AppError(
        "VALIDATION_ERROR",
        "A project extraction is already active.",
      );
    throw error;
  }
  return job.id;
}

export async function cancelClaimJob(actor: ClaimActor, id: string) {
  const job = await ownedJob(actor, id);
  await repo.cancel(job);
  const current = await repo.get(actor.projectId, id);
  if (current?.status === "cancelled")
    await settleClaimWallet(current, await repo.items(current.id));
  await recordClaimEvent(actor, id, "Requested extraction cancellation");
}
