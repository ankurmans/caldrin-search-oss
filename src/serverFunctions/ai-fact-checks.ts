import { createServerFn } from "@tanstack/react-start";
import {
  addBrandFact,
  checkRunFacts,
  factCheckReport,
  listBrandFacts,
  removeBrandFact,
} from "@/server/features/ai-fact-checks/services/aiFactChecks";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  addBrandFactSchema,
  factCheckReportSchema,
  removeBrandFactSchema,
} from "@/types/schemas/ai-fact-checks";
import { aiProjectSchema } from "@/types/schemas/ai-visibility";

export const listAiBrandFacts = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiProjectSchema)
  .handler(({ context }) => listBrandFacts(context.projectId));

export const addAiBrandFact = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(addBrandFactSchema)
  .handler(({ data, context }) =>
    addBrandFact(context.projectId, data.statement),
  );

export const removeAiBrandFact = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(removeBrandFactSchema)
  .handler(({ data, context }) =>
    removeBrandFact(context.projectId, data.factId),
  );

export const getAiFactCheckReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(factCheckReportSchema)
  .handler(({ data, context }) =>
    factCheckReport({ projectId: context.projectId, runId: data.runId }),
  );

export const checkAiBrandFacts = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(factCheckReportSchema.required({ runId: true }))
  .handler(({ data, context }) =>
    checkRunFacts({ projectId: context.projectId, runId: data.runId }, context),
  );
