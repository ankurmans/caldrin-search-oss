import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { AiMeasurementService } from "@/server/features/ai-visibility/services/AiMeasurementService";
import { AiMeasurementRefusal } from "@/server/features/ai-visibility/services/aiMeasurementLedger";
import {
  compareWindowsInputSchema,
  linkRunsInputSchema,
  listRunsInputSchema,
} from "@/server/features/ai-visibility/services/aiMeasurementSchemas";
import { LedgerRefusal } from "@/server/features/ledger/types";
import { requireProjectContext } from "@/serverFunctions/middleware";

const projectScoped = z.object({ projectId: z.string().min(1) });

export type AiMeasurementResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

// Expected refusals become typed results the UI can show; the app's error
// middleware only forwards bare error codes.
async function run<T>(fn: () => Promise<T>): Promise<AiMeasurementResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof AiMeasurementRefusal || error instanceof LedgerRefusal)
      return { ok: false, reason: error.message };
    throw error;
  }
}

export const getPromptSetVersions = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped)
  .handler(({ context }) =>
    AiMeasurementService.listPromptSetVersions(context.projectId),
  );

export const listAiVisibilityRunsForMeasurement = createServerFn({
  method: "POST",
})
  .middleware(requireProjectContext)
  .validator(projectScoped.and(listRunsInputSchema))
  .handler(({ data, context }) =>
    AiMeasurementService.listRuns(context.projectId, {
      from: data.from,
      to: data.to,
      locationCode: data.locationCode,
      languageCode: data.languageCode,
    }),
  );

export const compareAiVisibilityWindows = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.and(compareWindowsInputSchema))
  .handler(({ data, context }) =>
    AiMeasurementService.compareWindows(context.projectId, data),
  );

export const linkAiRunsToLedgerEntry = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.and(linkRunsInputSchema))
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return run(() =>
      AiMeasurementService.linkRunsToLedger(
        {
          projectId: context.projectId,
          organizationId: context.organizationId,
          userId: context.userId,
        },
        data,
      ),
    );
  });
