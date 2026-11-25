import { z } from "zod";
import { experimentCostPreview } from "@/shared/ai-perception-experiments";
import { aiIntelligenceSchema } from "@/types/schemas/ai-visibility-intelligence";
import {
  aiPerceptionExperimentIdSchema,
  loadAiPerceptionExperimentPageSchema,
  replayAiPerceptionExperimentToolSchema,
  saveAiPerceptionExperimentToolSchema,
  saveAiPerceptionOpportunitySchema,
} from "@/types/schemas/ai-perception";
import { aiProjectSchema } from "@/types/schemas/ai-visibility";
import { defineAiTool } from "./ai-visibility-tool-factory";

const loose = z.looseObject({});
const READS_SAVED =
  "Reads saved answers and readings only and uses no credits.";

export const getAiPerceptionOverviewTool = defineAiTool({
  name: "get_ai_perception_overview",
  title: "Get brand perception overview",
  input: aiIntelligenceSchema,
  output: z.looseObject({
    population: loose,
    brands: z.array(loose),
    heatmap: z.array(loose),
    unread: loose,
  }),
  readOnly: true,
  description: `Brand perception over the same saved answers and filters as the Visibility page. For your brand and the most-named competitors it gives the share of answers that name each brand and the share of read mentions recommended or discouraged, each with numerator and denominator, plus a prompt-by-brand heatmap of outcomes. The population block states the window, prompt set, engines, runs and how many planned collections produced no answer. Answers that name a brand but are not read yet are counted as unread, never as neutral. There is no combined reputation score. ${READS_SAVED}`,
  execute: async (_s, a) =>
    (
      await import("@/server/features/ai-perception/services/aiPerceptionView")
    ).loadPerceptionView(a),
  summarize: (d) =>
    `${d.brands.length} brands; ${typeof d.unread.answers === "number" ? d.unread.answers : 0} answers not read yet.`,
});

export const getAiPerceptionSourcesTool = defineAiTool({
  name: "get_ai_perception_sources",
  title: "Get sources and concerns behind perception",
  input: aiIntelligenceSchema,
  output: z.looseObject({
    sources: z.array(loose),
    themes: z.array(loose),
  }),
  readOnly: true,
  description: `Which sources sit behind answers that recommend or do not recommend your brand, split by who owns them (your site, competitors, third parties), and the strengths, weaknesses and buyer objections that recur across answers, each counted over the answers that raise it. A source appearing beside an answer is not shown to have caused it. ${READS_SAVED}`,
  execute: async (_s, a) =>
    (
      await import("@/server/features/ai-perception/services/aiPerceptionSources")
    ).loadPerceptionSources(a),
  summarize: (d) =>
    `${d.sources.length} sources and ${d.themes.length} recurring concerns.`,
});

export const getAiPerceptionOpportunitiesTool = defineAiTool({
  name: "get_ai_perception_opportunities",
  title: "Get perception opportunities",
  input: aiIntelligenceSchema,
  output: z.looseObject({
    opportunities: z.array(loose),
    notes: z.array(z.string()),
  }),
  readOnly: true,
  description: `Prioritised findings from saved answers: a competitor preferred over you, named but not recommended for a topic, absent where a competitor is recommended, recurring objections, unfavourable sources and answers that contradict a fact you set. Each has a count over the answers that track your brand, a priority, a confidence, what was observed, what is inferred and untested, the buyer questions, quoted evidence and a route (Content Studio, link acquisition or a person's decision). Remedies are hypotheses. ${READS_SAVED}`,
  execute: async (_s, a) =>
    (
      await import("@/server/features/ai-perception/services/aiPerceptionOpportunities")
    ).loadPerceptionOpportunities(a),
  summarize: (d) => `${d.opportunities.length} perception opportunities.`,
});

export const saveAiPerceptionOpportunityTool = defineAiTool({
  name: "save_ai_perception_opportunity",
  title: "Save a perception opportunity",
  input: saveAiPerceptionOpportunitySchema,
  output: z.looseObject({
    saved: z.boolean(),
    opportunityId: z.string().nullable(),
  }),
  readOnly: false,
  description:
    "Store one finding from get_ai_perception_opportunities as an opportunity, with its evidence, for the Content Studio flow. Pass the same filters you used to read it and the finding's id. Saves again to the same opportunity if it already exists. Uses no credits.",
  execute: async (_s, a, billing) => {
    const saved = await (
      await import("@/server/features/ai-perception/services/aiPerceptionOpportunities")
    ).savePerceptionOpportunity(
      { projectId: a.projectId, organizationId: billing.organizationId },
      a,
    );
    return { saved: !!saved, opportunityId: saved?.opportunityId ?? null };
  },
  summarize: (d) =>
    d.saved
      ? "Saved to Opportunities."
      : "That finding is not in these answers.",
});

export const listAiPerceptionExperimentsTool = defineAiTool({
  name: "list_ai_perception_experiments",
  title: "List content experiments",
  input: aiProjectSchema,
  output: z.looseObject({
    experiments: z.array(loose),
    prompts: z.array(loose),
  }),
  readOnly: true,
  description: `Saved content experiments (a page edit replayed against saved prompts) with their status, and the project's prompts that an experiment can use. ${READS_SAVED}`,
  execute: async (_s, a) =>
    (
      await import("@/server/features/ai-perception/services/perceptionExperiments")
    ).listExperiments(a.projectId),
  summarize: (d) => `${d.experiments.length} experiments.`,
});

export const getAiPerceptionExperimentTool = defineAiTool({
  name: "get_ai_perception_experiment",
  title: "Get a content experiment",
  input: aiPerceptionExperimentIdSchema,
  output: z.looseObject({
    id: z.string(),
    status: z.string(),
    simulationNote: z.string(),
    verdict: loose.nullable(),
  }),
  readOnly: true,
  description: `One experiment with the page text as it stands, the proposed edit, assumptions, and after a replay the result: recommended answers out of answers for each version, the spread across repeats of the original page, and how saved real answers for the same prompts read. The replay is simulated: a model handed the page, not an engine retrieving it. ${READS_SAVED}`,
  execute: async (_s, a) => {
    const { getExperiment } =
      await import("@/server/features/ai-perception/services/perceptionExperiments");
    const found = await getExperiment(a.projectId, a.experimentId);
    if (!found) throw new Error("Experiment not found.");
    return found;
  },
  summarize: (d) =>
    `Experiment ${d.status}${d.verdict ? `: ${String(d.verdict.call)}` : ""}.`,
});

export const loadAiPerceptionExperimentPageTool = defineAiTool({
  name: "load_ai_perception_experiment_page",
  title: "Read a page for a content experiment",
  input: loadAiPerceptionExperimentPageSchema,
  output: z.looseObject({ ok: z.boolean() }),
  readOnly: true,
  openWorld: true,
  description:
    "Fetch the visible text of a public page so an experiment can start from what is live. Public addresses only; redirects are checked and robots.txt is respected. Includes menus and footers. Uses no credits.",
  execute: async (_s, a) =>
    (
      await import("@/server/features/ai-perception/services/experimentPageLoad")
    ).loadExperimentPage(a.url),
  summarize: (d) => {
    if (d.ok) return "Page read.";
    return typeof d.reason === "string" ? d.reason : "Page not read.";
  },
});

export const saveAiPerceptionExperimentTool = defineAiTool({
  name: "save_ai_perception_experiment",
  title: "Create or update a content experiment",
  input: saveAiPerceptionExperimentToolSchema,
  output: z.looseObject({ id: z.string() }),
  readOnly: false,
  description:
    "Create a content experiment from the page text as it stands, a proposed edit, your assumptions, up to 5 of the project's prompt ids (list_ai_perception_experiments shows them) and 1 to 5 repeats (3 or more are needed to measure run-to-run spread). Pass experimentId to change an existing one; any change clears its earlier replay. Nothing is replayed or published. After a replay, queue_ai_perception_experiment_opportunity sends it to Opportunities. Uses no credits.",
  execute: async (_s, a, billing) => {
    const { createExperiment, updateExperiment } =
      await import("@/server/features/ai-perception/services/perceptionExperiments");
    const { experimentId, projectId: _p, ...fields } = a;
    const scope = { projectId: a.projectId, userId: billing.userId ?? null };
    const input = { ...fields, sourceUrl: fields.sourceUrl ?? null };
    return experimentId
      ? updateExperiment(scope, experimentId, input)
      : createExperiment(scope, input);
  },
  summarize: (d) => `Experiment saved (${d.id}).`,
});

export const replayAiPerceptionExperimentTool = defineAiTool({
  name: "replay_ai_perception_experiment",
  title: "Replay a content experiment",
  input: replayAiPerceptionExperimentToolSchema,
  output: z.looseObject({
    replays: z.number(),
    planned: z.number(),
    costUsd: z.number(),
  }),
  readOnly: false,
  description:
    "Hand a model the original page, then the edited page, for each chosen prompt and repeat, and read how every answer treats your brand. Costs model credits: up to prompts x repeats x 2 answers, roughly $0.003 each, and it is refused when that upper estimate is above maxCostUsd. A rerun replaces the earlier replay. The result is simulated and labelled so; a difference inside the spread of the original page's repeats is reported as noise.",
  execute: async (_s, a, billing) => {
    const { getExperiment } =
      await import("@/server/features/ai-perception/services/perceptionExperiments");
    const experiment = await getExperiment(a.projectId, a.experimentId);
    if (!experiment) throw new Error("Experiment not found.");
    const preview = experimentCostPreview(
      experiment.promptResults.length,
      experiment.repeats,
    );
    if (preview.estimatedUsd > a.maxCostUsd)
      throw new Error(
        `This replay could cost up to $${preview.estimatedUsd.toFixed(3)} (${preview.calls} answers), above your limit of $${a.maxCostUsd}. Raise maxCostUsd or lower the prompts or repeats.`,
      );
    const { replayExperiment } =
      await import("@/server/features/ai-perception/services/experimentReplay");
    return replayExperiment(billing, {
      projectId: a.projectId,
      id: a.experimentId,
    });
  },
  summarize: (d) =>
    `Replayed ${d.replays} of ${d.planned} answers for $${d.costUsd.toFixed(3)}.`,
});

export const queueAiPerceptionExperimentOpportunityTool = defineAiTool({
  name: "queue_ai_perception_experiment_opportunity",
  title: "Queue a replayed experiment as an opportunity",
  input: aiPerceptionExperimentIdSchema,
  output: z.looseObject({ opportunityId: z.string() }),
  readOnly: false,
  description:
    "Send a replayed experiment to Opportunities, with its replay result and proposed text as evidence, for the Content Studio flow. It is labelled as queued by an agent and still simulated. Refused before a replay, or when the replay had fewer than 3 repeats and so no measured spread. Queueing again updates the same opportunity. Nothing is drafted or published. Uses no credits.",
  execute: async (_s, a, billing) => {
    const { approveExperiment } =
      await import("@/server/features/ai-perception/services/perceptionExperiments");
    return approveExperiment(
      { projectId: a.projectId, organizationId: billing.organizationId },
      a.experimentId,
      "agent",
    );
  },
  summarize: () => "Queued in Opportunities.",
});
