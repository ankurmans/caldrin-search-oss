import { getLedgerScreenDetail } from "@/server/features/ledger/services/editorialLedger";
import { createServerFn } from "@tanstack/react-start";
import { AuditLogService } from "@/server/features/audit-log/services/AuditLogService";
import { z } from "zod";
import { changeLedgerEntries } from "@/db/schema";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { collectGa4Observations } from "@/server/features/ledger/services/ga4Observations";
import { ContentRefusal } from "@/server/features/content/rules/contentRefusal";
import { approveShopifyChange } from "@/server/features/content/services/shopifyChangePlan";
import { LedgerService } from "@/server/features/ledger/services/LedgerService";
import { LedgerRefusal } from "@/server/features/ledger/types";
import { requireProjectContext } from "@/serverFunctions/middleware";

const projectScoped = z.object({ projectId: z.string().min(1) });
const entryScoped = projectScoped.extend({ entryId: z.string().min(1) });

const kinds = z.enum(changeLedgerEntries.kind.enumValues);
const providers = z.enum(changeLedgerEntries.provider.enumValues);
const statuses = z.enum(changeLedgerEntries.status.enumValues);
const rollbackKinds = z.enum(changeLedgerEntries.rollbackKind.enumValues);

const listSchema = projectScoped.extend({
  status: statuses.optional(),
  kind: kinds.optional(),
  opportunityId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
// Evidence is not accepted from the browser: it is copied from the
// opportunity's own evidence rows, so a proposal cannot carry invented proof.
const proposeSchema = projectScoped.extend({
  kind: kinds,
  provider: providers,
  proposedAction: z.string().min(1).max(500),
  opportunityId: z.string().min(1).nullish(),
  contentAssetId: z.string().min(1).nullish(),
  contentRevision: z.number().int().min(1).nullish(),
  targetUrl: z.url().max(2000).nullish(),
  beforeState: z.string().max(100_000).nullish(),
  afterState: z.string().max(100_000).nullish(),
  rollbackKind: rollbackKinds.optional(),
  measurementMetric: z.string().min(1).max(100).nullish(),
  measurementWindowDays: z.number().int().min(1).max(365).nullish(),
});
const rejectSchema = entryScoped.extend({
  reason: z.string().min(1).max(1000),
});
const decisionSchema = entryScoped.extend({
  text: z.string().min(1).max(2000),
});

export type LedgerResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

// Expected refusals (approval missing, content moved, wrong state) become typed
// results the UI can show; the app's error middleware only forwards bare codes.
async function run<T>(fn: () => Promise<T>): Promise<LedgerResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof LedgerRefusal || error instanceof ContentRefusal) {
      return { ok: false, reason: error.message };
    }
    throw error;
  }
}

// Records an approval-type decision once it actually went through.
async function recordDecision<T>(
  context: Parameters<typeof scopeOf>[0] & { userEmail: string },
  result: LedgerResult<T>,
  action:
    | "ledger.change_approved"
    | "ledger.change_rejected"
    | "ledger.decision_recorded",
  summary: string,
  entryId: string,
) {
  if (result.ok) {
    await AuditLogService.recordUser(context, action, summary, {
      projectId: context.projectId,
      targetKind: "ledger_entry",
      targetId: entryId,
    });
  }
  return result;
}

function scopeOf(context: {
  projectId: string;
  organizationId: string;
  userId: string;
}) {
  return {
    projectId: context.projectId,
    organizationId: context.organizationId,
    userId: context.userId,
  };
}

export const getLedgerEntries = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listSchema)
  .handler(async ({ data, context }) =>
    LedgerService.listEntriesWithNames(context.projectId, {
      status: data.status,
      kind: data.kind,
      opportunityId: data.opportunityId,
      limit: data.limit,
    }),
  );

export const getLedgerEntry = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(entryScoped)
  .handler(async ({ data, context }) =>
    run(() => getLedgerScreenDetail(context.projectId, data.entryId)),
  );

export const proposeLedgerChange = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(proposeSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() => LedgerService.proposeChange(scopeOf(context), data));
  });

export const approveLedgerChange = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(entryScoped)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    // A Shopify change is approved with its draft and quality checks, never
    // by the generic path.
    const result = await run(async () => {
      const { entry } = await LedgerService.getEntry(
        context.projectId,
        data.entryId,
      );
      return entry.provider === "shopify"
        ? approveShopifyChange(scopeOf(context), data.entryId)
        : LedgerService.approveChange(scopeOf(context), data.entryId);
    });
    return recordDecision(
      context,
      result,
      "ledger.change_approved",
      "Approved a proposed change",
      data.entryId,
    );
  });

export const rejectLedgerChange = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(rejectSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const result = await run(() =>
      LedgerService.rejectChange(scopeOf(context), data.entryId, data.reason),
    );
    return recordDecision(
      context,
      result,
      "ledger.change_rejected",
      "Rejected a proposed change",
      data.entryId,
    );
  });

export const recordLedgerFinalDecision = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(decisionSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const result = await run(() =>
      LedgerService.recordFinalDecision(
        scopeOf(context),
        data.entryId,
        data.text,
      ),
    );
    return recordDecision(
      context,
      result,
      "ledger.decision_recorded",
      "Recorded the final decision on a change",
      data.entryId,
    );
  });

export const collectLedgerObservations = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(entryScoped)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      LedgerService.collectGscObservations(scopeOf(context), data.entryId),
    );
  });

export const collectLedgerGa4Observations = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(entryScoped)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      collectGa4Observations({
        projectId: context.projectId,
        entryId: data.entryId,
      }),
    );
  });
