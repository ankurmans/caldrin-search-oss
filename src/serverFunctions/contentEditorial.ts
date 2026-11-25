import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  assignDraftReviewer,
  getProjectDraftReviewers,
} from "@/server/features/content/services/draftReviewAssignment";
import {
  queueContentRefresh,
  retryContentRefresh,
  listContentRefresh,
} from "@/server/features/content/services/contentRefreshQueue";
import { REFRESH_QUEUE_LIMIT } from "@/shared/refreshQueue";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  startEditorialDraft as startDraft,
  getAssetDetail,
  editDraft,
} from "@/server/features/content/services/editorialDrafts";
import { getContentPerformance } from "@/server/features/content/services/contentPerformance";
import {
  estimateEditorialDraft,
  writeEditorialDraft,
} from "@/server/features/content/services/writeEditorialDraft";
import { SpendLimitRefusal } from "@/server/features/spend/types";
import { ContentRefusal } from "@/server/features/content/rules/contentRefusal";

const projectScoped = z.object({ projectId: z.string().min(1) });
const assetScoped = projectScoped.extend({ assetId: z.string().min(1) });
const editSchema = assetScoped.extend({
  expectedRevision: z.number().int().positive().optional(),
  title: z.string().min(1).max(200),
  bodyHtml: z.string().min(1).max(100_000),
  metaTitle: z.string().min(1).max(120),
  metaDescription: z.string().max(320),
});

export const startEditorialDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScoped.extend({
      opportunityId: z.string().min(1).max(100).optional(),
      url: z.url().max(2048).optional(),
      title: z.string().trim().max(200).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() => startDraft(context, data));
  });

export const getContentPerformanceReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped)
  .handler(async ({ context }) => getContentPerformance(context.projectId));

async function run<T>(work: () => Promise<T>) {
  try {
    return { ok: true as const, data: await work() };
  } catch (error) {
    if (error instanceof ContentRefusal || error instanceof SpendLimitRefusal)
      return { ok: false as const, reason: error.message };
    throw error;
  }
}

export const getContentDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(assetScoped)
  .handler(async ({ data, context }) =>
    run(() => getAssetDetail(context.projectId, data.assetId)),
  );

export const editContentDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(editSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      editDraft(
        context,
        data.assetId,
        {
          title: data.title,
          bodyHtml: data.bodyHtml,
          metaTitle: data.metaTitle,
          metaDescription: data.metaDescription,
        },
        data.expectedRevision,
      ),
    );
  });

const aiWriting = assetScoped.extend({
  expectedRevision: z.number().int().positive(),
  query: z.string().trim().min(3).max(300),
  guidance: z.string().trim().max(1500).optional(),
  bodyHtml: z.string().max(100_000),
  searchWeb: z.boolean().default(false),
});

export const getEditorialDraftEstimate = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiWriting.pick({ projectId: true, query: true }))
  .handler(({ data, context }) =>
    estimateEditorialDraft(data.query, context.project),
  );

export const generateEditorialDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiWriting)
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() => writeEditorialDraft(context, data, context.project));
  });

export const listQueuedRefreshes = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped)
  .handler(({ context }) => listContentRefresh(context.projectId));

export const enqueueContentRefresh = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScoped.extend({
      opportunityIds: z
        .array(z.string().min(1).max(100))
        .min(1)
        .max(REFRESH_QUEUE_LIMIT),
    }),
  )
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() => queueContentRefresh(context, data.opportunityIds));
  });

export const retryQueuedRefresh = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ jobId: z.string().min(1).max(100) }))
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(async () => {
      await retryContentRefresh(context, data.jobId);
      return true;
    });
  });

export const getDraftReviewers = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped)
  .handler(({ context }) => getProjectDraftReviewers(context));

export const setDraftReviewer = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    assetScoped.extend({ reviewer: z.string().min(1).max(150).nullable() }),
  )
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(async () => {
      await assignDraftReviewer(context, data.assetId, data.reviewer);
      return { reviewer: data.reviewer };
    });
  });
