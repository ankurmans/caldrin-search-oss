import { createClaimClientReport } from "@/server/features/ai-claims/claimClientReport";
import { captureClaimEvent } from "@/server/features/ai-claims/claimAnalytics";
import {
  recordClaimFollowup,
  recheckClaimCorrection,
} from "@/server/features/ai-claims/claimFollowups";
import {
  claimGroupSuggestions,
  groupClaims,
} from "@/server/features/ai-claims/claimGrouping";
import {
  approveClaimCorrection,
  createClaimCorrection,
  listClaimCorrections,
  verifyClaimPublication,
} from "@/server/features/ai-claims/claimCorrections";
import {
  captureClaimEvidence,
  getClaimEvidence,
  reviewClaimSource,
} from "@/server/features/ai-claims/claimSourceService";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { claimCategories, claimFactInput } from "@/shared/ai-claims";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  claimsEnabledForWorkspace,
  estimateClaimJob,
  startClaimJob,
  cancelClaimJob,
} from "@/server/features/ai-claims/claimJobs";
import {
  assessClaim,
  draftClaimFact,
  loadClaimOverview,
  reviewClaimAssessment,
  reviewClaimFact,
} from "@/server/features/ai-claims/claimService";
import { hasOrgPermission, isClientGuest } from "@/lib/org-permissions";

const project = z.object({ projectId: z.string().min(1).max(100) });
const id = project.extend({ id: z.string().min(1).max(100) });

export const getClaimsAvailability = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(project)
  .handler(
    async ({ context }) =>
      !isClientGuest(context.role) &&
      hasOrgPermission(context.role, { integration: ["manage"] }) &&
      (await claimsEnabledForWorkspace(context.organizationId)),
  );

export const getClaimOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    project.extend({
      engine: z.string().max(40).optional(),
      market: z.number().int().positive().optional(),
      category: z.enum(claimCategories).optional(),
      since: z.iso.date().optional(),
      until: z.iso.date().optional(),
    }),
  )
  .handler(({ context, data }) => loadClaimOverview(context, data));

export const estimateClaims = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    project.extend({
      runId: z.string().max(100),
      funding: z.enum(["byok", "hosted"]).default("byok"),
      observationIds: z.array(z.string().max(100)).max(20).optional(),
    }),
  )
  .handler(({ context, data }) =>
    estimateClaimJob(context, data.runId, data.observationIds, data.funding),
  );

export const startClaims = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(id.extend({ maxCalls: z.number().int().min(0).max(20) }))
  .handler(({ context, data }) =>
    startClaimJob(context, data.id, data.maxCalls),
  );

export const cancelClaims = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(id)
  .handler(({ context, data }) => cancelClaimJob(context, data.id));

export const readClaimEvidence = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(id)
  .handler(async ({ context, data }) => {
    const evidence = await getClaimEvidence(context, data.id);
    await captureClaimEvent(context, "evidence_inspected");
    return evidence;
  });

export const fetchClaimEvidence = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    id.extend({
      url: z.url().max(1200),
      passage: z.string().trim().min(5).max(240),
    }),
  )
  .handler(({ context, data }) =>
    captureClaimEvidence(context, data.id, data.url, data.passage),
  );

export const saveClaimFactDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(project.extend({ fact: claimFactInput }))
  .handler(({ context, data }) => draftClaimFact(context, data.fact));

export const decideClaimFact = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(id.extend({ action: z.enum(["approve", "retire"]) }))
  .handler(({ context, data }) =>
    reviewClaimFact(context, data.id, data.action),
  );

export const compareClaimFacts = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(id)
  .handler(({ context, data }) => assessClaim(context, data.id));

export const decideClaimAssessment = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(id.extend({ review: z.enum(["confirmed", "dismissed"]) }))
  .handler(({ context, data }) =>
    reviewClaimAssessment(context, data.id, data.review),
  );

export const regroupClaim = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(id.extend({ target: z.string().max(100).nullable() }))
  .handler(({ context, data }) => groupClaims(context, data.id, data.target));

export const decideClaimSource = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    id.extend({
      snapshotId: z.string().max(100),
      relation: z.enum([
        "corroborating",
        "conflicting",
        "potentially_stale",
        "insufficient",
      ]),
      relevance: z.enum(["direct", "context_only"]),
      rationale: z.string().trim().min(8).max(500),
    }),
  )
  .handler(({ context, data }) => {
    const {
      id: occurrenceId,
      snapshotId,
      relation,
      relevance,
      rationale,
    } = data;
    return reviewClaimSource(context, occurrenceId, {
      snapshotId,
      relation,
      relevance,
      rationale,
    });
  });

export const getClaimGroupSuggestions = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(id)
  .handler(({ context, data }) => claimGroupSuggestions(context, data.id));

export const getClaimCorrections = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(id)
  .handler(({ context, data }) => listClaimCorrections(context, data.id));

export const draftClaimCorrection = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    project.extend({
      assessmentId: z.string().max(100),
      factId: z.string().max(100),
      targetUrl: z.url().max(1200),
      kind: z.enum(["owned", "external"]),
    }),
  )
  .handler(({ context, data }) => createClaimCorrection(context, data));

export const reviewClaimCorrection = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(id)
  .handler(({ context, data }) => approveClaimCorrection(context, data.id));

export const checkClaimPublication = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(id.extend({ passage: z.string().trim().min(5).max(240) }))
  .handler(({ context, data }) =>
    verifyClaimPublication(context, data.id, data.passage),
  );

export const saveClaimFollowup = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(id.extend({ observationId: z.string().max(100) }))
  .handler(({ context, data }) =>
    recordClaimFollowup(context, data.id, data.observationId),
  );

export const recheckCorrection = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    id.extend({
      approval: z
        .object({
          maxCostUsd: z.number().nonnegative().max(100),
          maxCredits: z.number().int().nonnegative().max(1000),
        })
        .optional(),
    }),
  )
  .handler(({ context, data }) =>
    recheckClaimCorrection(context, data.id, data.approval),
  );

export const saveClaimClientReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(id)
  .handler(({ context, data }) => createClaimClientReport(context, data.id));
