import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { ContentRefusal } from "@/server/features/content/rules/contentRefusal";
import { OpportunityRefusal } from "@/server/features/opportunities/types";
import { CompetitorExplorerService } from "@/server/features/site-explorer/services/CompetitorExplorerService";
import {
  KeywordGapExplorerService,
  type ExplorerContext,
} from "@/server/features/site-explorer/services/KeywordGapExplorerService";
import { SpendLimitRefusal } from "@/server/features/spend/types";
import { DISMISSAL_KINDS } from "@/shared/competitor-dismissal";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  competitorMarketSchema,
  explorerMarketSchema,
  keywordGapQuerySchema,
  keywordGapRunInputSchema,
} from "@/types/schemas/keyword-gap";

const projectScoped = z.object({ projectId: z.string().min(1) });
const market = explorerMarketSchema;

type ExplorerResult<T> = { ok: true; data: T } | { ok: false; reason: string };

async function run<T>(fn: () => Promise<T>): Promise<ExplorerResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (
      error instanceof OpportunityRefusal ||
      error instanceof SpendLimitRefusal ||
      error instanceof ContentRefusal
    ) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}

function scopeOf(context: {
  projectId: string;
  organizationId: string;
  userId: string;
  userEmail: string;
}): ExplorerContext {
  return {
    projectId: context.projectId,
    organizationId: context.organizationId,
    userId: context.userId,
    userEmail: context.userEmail,
  };
}

// ---- Reads of stored data. None of these call a provider. ----

export const getKeywordGap = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ query: keywordGapQuerySchema }))
  .handler(({ data, context }) =>
    KeywordGapExplorerService.list(context.projectId, data.query),
  );

export const exportKeywordGap = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ query: keywordGapQuerySchema }))
  .handler(({ data, context }) =>
    KeywordGapExplorerService.exportRows(context.projectId, data.query),
  );

export const getSavedCompetitors = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped)
  .handler(({ context }) => CompetitorExplorerService.list(context.projectId));

export const getCachedCompetitorDiscovery = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ market: market.optional() }))
  .handler(({ data, context }) =>
    CompetitorExplorerService.cachedDiscovery(scopeOf(context), data.market),
  );

// ---- Cost previews. No provider call. ----

export const estimateKeywordGap = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ input: keywordGapRunInputSchema }))
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return KeywordGapExplorerService.estimate(scopeOf(context), data.input);
  });

export const estimateCompetitorDiscovery = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ market: market.optional() }))
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return CompetitorExplorerService.estimateDiscovery(
      scopeOf(context),
      data.market,
    );
  });

// ---- Paid runs: managers only, re-checked against limits in the service. ----

export const runKeywordGap = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScoped.extend({
      input: keywordGapRunInputSchema,
      repeat: z.boolean().optional(),
    }),
  )
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      KeywordGapExplorerService.run(scopeOf(context), data.input, {
        repeat: data.repeat === true,
      }),
    );
  });

export const discoverCompetitors = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ market: market.optional() }))
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      CompetitorExplorerService.discover(scopeOf(context), data.market),
    );
  });

// ---- Writes to stored data. ----

export const decideKeywordGapRows = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScoped.extend({
      runId: z.string().min(1),
      rowIds: z.array(z.string().min(1)).min(1).max(200),
      patch: z.object({
        status: z.enum(["active", "watching", "dismissed"]).optional(),
        targetPageUrl: z.string().trim().url().max(2048).nullable().optional(),
      }),
    }),
  )
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      KeywordGapExplorerService.decide(scopeOf(context), {
        runId: data.runId,
        rowIds: data.rowIds,
        patch: data.patch,
      }),
    );
  });

export const createOpportunityFromGap = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScoped.extend({
      runId: z.string().min(1),
      rowId: z.string().min(1),
    }),
  )
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      KeywordGapExplorerService.createOpportunity(scopeOf(context), {
        runId: data.runId,
        rowId: data.rowId,
      }),
    );
  });

export const createBriefFromGap = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScoped.extend({
      runId: z.string().min(1),
      rowId: z.string().min(1),
    }),
  )
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      KeywordGapExplorerService.createBrief(scopeOf(context), {
        runId: data.runId,
        rowId: data.rowId,
      }),
    );
  });

export const addExplorerCompetitors = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScoped.extend({
      domains: z.array(z.string().trim().min(1).max(253)).min(1).max(20),
      discovered: z.boolean().optional(),
    }),
  )
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      CompetitorExplorerService.add(scopeOf(context), {
        domains: data.domains,
        discovered: data.discovered,
      }),
    );
  });

export const dismissExplorerCompetitors = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScoped.extend({
      domains: z.array(z.string().trim().min(1).max(253)).min(1).max(200),
      kind: z.enum(DISMISSAL_KINDS),
    }),
  )
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      CompetitorExplorerService.dismiss(scopeOf(context), {
        domains: data.domains,
        kind: data.kind,
      }),
    );
  });

export const restoreExplorerCompetitor = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScoped.extend({ domain: z.string().trim().min(1).max(253) }),
  )
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      CompetitorExplorerService.restore(scopeOf(context), data.domain),
    );
  });

export const removeExplorerCompetitor = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScoped.extend({ domain: z.string().trim().min(1).max(253) }),
  )
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      CompetitorExplorerService.remove(scopeOf(context), data.domain),
    );
  });

export const setCompetitorMarkets = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScoped.extend({
      domain: z.string().trim().min(1).max(253),
      markets: z.array(competitorMarketSchema).max(10),
    }),
  )
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      CompetitorExplorerService.setMarkets(scopeOf(context), {
        domain: data.domain,
        markets: data.markets,
      }),
    );
  });

export const getSavedTableViews = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ tableKey: z.string().min(1).max(60) }))
  .handler(({ data, context }) =>
    CompetitorExplorerService.listViews(context.projectId, data.tableKey),
  );

export const saveTableView = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScoped.extend({
      tableKey: z.string().min(1).max(60),
      name: z.string().trim().min(1).max(60),
      config: z.string().max(4000),
    }),
  )
  .handler(({ data, context }) =>
    CompetitorExplorerService.saveView(context.projectId, {
      tableKey: data.tableKey,
      name: data.name,
      config: data.config,
    }),
  );

export const deleteTableView = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ id: z.string().min(1) }))
  .handler(({ data, context }) =>
    CompetitorExplorerService.deleteView(context.projectId, data.id),
  );
