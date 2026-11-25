import { createServerFn } from "@tanstack/react-start";
import { loadPerceptionExport } from "@/server/features/ai-perception/services/perceptionExport";
import { requireOrgPermission } from "@/server/auth/org-gate";
import {
  loadPerceptionOpportunities,
  savePerceptionOpportunity,
} from "@/server/features/ai-perception/services/aiPerceptionOpportunities";
import {
  loadPerceptionCell,
  loadPerceptionView,
} from "@/server/features/ai-perception/services/aiPerceptionView";
import {
  loadPerceptionSourceEvidence,
  loadPerceptionSources,
} from "@/server/features/ai-perception/services/aiPerceptionSources";
import {
  approveExperiment,
  createExperiment,
  deleteExperiment,
  getExperiment,
  listExperiments,
  updateExperiment,
} from "@/server/features/ai-perception/services/perceptionExperiments";
import { loadExperimentPage } from "@/server/features/ai-perception/services/experimentPageLoad";
import { replayExperiment } from "@/server/features/ai-perception/services/experimentReplay";
import { reviewPerception } from "@/server/features/ai-perception/services/aiPerception";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { aiProjectSchema } from "@/types/schemas/ai-visibility";
import {
  aiPerceptionCellSchema,
  aiPerceptionExportSchema,
  aiPerceptionExperimentIdSchema,
  loadAiPerceptionExperimentPageSchema,
  updateAiPerceptionExperimentSchema,
  aiPerceptionSourceEvidenceSchema,
  saveAiPerceptionOpportunitySchema,
  reviewAiPerceptionSchema,
} from "@/types/schemas/ai-perception";
import { aiIntelligenceSchema } from "@/types/schemas/ai-visibility-intelligence";

export const getAiPerceptionView = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiIntelligenceSchema)
  .handler(({ data, context }) =>
    loadPerceptionView({ ...data, projectId: context.projectId }),
  );

export const getAiPerceptionExport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiPerceptionExportSchema)
  .handler(({ data, context }) =>
    loadPerceptionExport({ ...data, projectId: context.projectId }),
  );

export const getAiPerceptionCell = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiPerceptionCellSchema)
  .handler(({ data, context }) =>
    loadPerceptionCell({ ...data, projectId: context.projectId }),
  );

export const reviewAiPerception = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(reviewAiPerceptionSchema)
  .handler(({ data, context }) =>
    reviewPerception(
      { ...data, projectId: context.projectId },
      context.userId ?? null,
    ),
  );

export const getAiPerceptionSources = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiIntelligenceSchema)
  .handler(({ data, context }) =>
    loadPerceptionSources({ ...data, projectId: context.projectId }),
  );

export const getAiPerceptionSourceEvidence = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiPerceptionSourceEvidenceSchema)
  .handler(({ data, context }) =>
    loadPerceptionSourceEvidence({ ...data, projectId: context.projectId }),
  );

export const getAiPerceptionOpportunities = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiIntelligenceSchema)
  .handler(({ data, context }) =>
    loadPerceptionOpportunities({ ...data, projectId: context.projectId }),
  );

export const saveAiPerceptionOpportunity = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(saveAiPerceptionOpportunitySchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const saved = await savePerceptionOpportunity(
      {
        projectId: context.projectId,
        organizationId: context.organizationId,
      },
      { ...data, projectId: context.projectId },
    );
    return saved
      ? { ok: true as const, ...saved }
      : {
          ok: false as const,
          reason:
            "That finding is not in the answers for these filters any more. Reload and try again.",
        };
  });

export const listAiPerceptionExperiments = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiProjectSchema)
  .handler(({ context }) => listExperiments(context.projectId));

export const getAiPerceptionExperiment = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiPerceptionExperimentIdSchema)
  .handler(({ data, context }) =>
    getExperiment(context.projectId, data.experimentId),
  );

export const saveAiPerceptionExperiment = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(updateAiPerceptionExperimentSchema.partial({ experimentId: true }))
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const { experimentId, projectId: _p, ...fields } = data;
    const scope = {
      projectId: context.projectId,
      userId: context.userId ?? null,
    };
    const input = { ...fields, sourceUrl: fields.sourceUrl ?? null };
    return experimentId
      ? updateExperiment(scope, experimentId, input)
      : createExperiment(scope, input);
  });

export const replayAiPerceptionExperiment = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiPerceptionExperimentIdSchema)
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return replayExperiment(context, {
      projectId: context.projectId,
      id: data.experimentId,
    });
  });

export const approveAiPerceptionExperiment = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiPerceptionExperimentIdSchema)
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return approveExperiment(
      {
        projectId: context.projectId,
        organizationId: context.organizationId,
      },
      data.experimentId,
    );
  });

export const deleteAiPerceptionExperiment = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(aiPerceptionExperimentIdSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await deleteExperiment(context.projectId, data.experimentId);
    return { ok: true as const };
  });

export const loadAiPerceptionExperimentPage = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(loadAiPerceptionExperimentPageSchema)
  .handler(({ data }) => loadExperimentPage(data.url));
