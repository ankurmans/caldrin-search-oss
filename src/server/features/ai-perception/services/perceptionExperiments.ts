import { sort } from "remeda";
import { AiVisibilityRepository as visibility } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import type { OpportunityCandidate } from "@/server/features/opportunities/types";
import { AppError } from "@/server/lib/errors";
import { PERCEPTION_CLASSIFIER_VERSION } from "@/shared/ai-perception";
import {
  type ExperimentArm,
  type ExperimentArmTally,
  type ExperimentPromptResult,
  type PerceptionExperiment,
  type PerceptionExperimentList,
} from "@/shared/ai-perception-experiments";
import { AiPerceptionExperimentRepository as repo } from "../repositories/AiPerceptionExperimentRepository";
import { experimentVerdict } from "./experimentVerdict";

const SIMULATION_NOTE =
  "Simulated. A model was handed each version of the page and asked the saved prompt. No answer engine retrieved this page, so this shows how wording can read, not what an engine will say.";

interface ExperimentScope {
  projectId: string;
  userId: string | null;
}

interface ExperimentFields {
  title: string;
  sourceUrl: string | null;
  originalText: string;
  editedText: string;
  assumptions: string;
  repeats: number;
  promptIds: string[];
}

async function ownBrand(projectId: string) {
  const project = await visibility.getProject(projectId);
  if (!project) throw new AppError("NOT_FOUND");
  return {
    name: project.brandName?.trim() || project.name,
    domain: project.domain ?? "",
  };
}

export async function promptRows(projectId: string) {
  const config = await visibility.getConfiguration(projectId);
  return (config?.prompts ?? []).filter((p) => !p.archived);
}

export async function listExperiments(
  projectId: string,
): Promise<PerceptionExperimentList> {
  const [brand, rows, prompts] = await Promise.all([
    ownBrand(projectId),
    repo.list(projectId),
    promptRows(projectId),
  ]);
  return {
    brand: brand.domain ? brand : null,
    experiments: rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      sourceUrl: r.sourceUrl,
      createdAt: r.createdAt,
      replayedAt: r.replayedAt,
      approvedAt: r.approvedAt,
      approvedBy: r.approvedBy,
      repeats: r.repeats,
      prompts: r.prompts,
      costUsd: r.costUsd,
    })),
    prompts: prompts.map((p) => ({
      promptId: p.id,
      prompt: p.text,
      topic: p.topic,
    })),
  };
}

async function checkPrompts(projectId: string, promptIds: string[]) {
  const known = new Set((await promptRows(projectId)).map((p) => p.id));
  if (promptIds.some((id) => !known.has(id)))
    throw new AppError("VALIDATION_ERROR", "Choose prompts from this project.");
}

export async function createExperiment(
  scope: ExperimentScope,
  input: ExperimentFields,
) {
  await checkPrompts(scope.projectId, input.promptIds);
  const brand = await ownBrand(scope.projectId);
  const id = crypto.randomUUID();
  await repo.create(
    {
      id,
      projectId: scope.projectId,
      title: input.title,
      sourceUrl: input.sourceUrl,
      originalText: input.originalText,
      editedText: input.editedText,
      assumptions: input.assumptions,
      repeats: input.repeats,
      status: "draft",
      brandName: brand.name,
      brandDomain: brand.domain,
      costUsd: 0,
      createdBy: scope.userId,
      createdAt: new Date().toISOString(),
    },
    input.promptIds,
  );
  return { id };
}

export async function updateExperiment(
  scope: ExperimentScope,
  id: string,
  input: ExperimentFields,
) {
  const found = await repo.get(scope.projectId, id);
  if (!found) throw new AppError("NOT_FOUND");
  await checkPrompts(scope.projectId, input.promptIds);
  const { promptIds, ...fields } = input;
  await repo.updateDraft(id, fields, promptIds);
  return { id };
}

export async function deleteExperiment(projectId: string, id: string) {
  if (!(await repo.remove(projectId, id))) throw new AppError("NOT_FOUND");
}

const tally = (
  list: { named: boolean; stance: string | null }[],
): ExperimentArmTally => ({
  answers: list.length,
  named: list.filter((r) => r.named).length,
  recommended: list.filter((r) => r.stance === "recommended").length,
});

export async function getExperiment(
  projectId: string,
  id: string,
): Promise<PerceptionExperiment | null> {
  const found = await repo.get(projectId, id);
  if (!found) return null;
  const { experiment, promptIds, replays } = found;
  const prompts = (await promptRows(projectId)).filter((p) =>
    promptIds.includes(p.id),
  );
  const real = await repo.realReadings(
    projectId,
    promptIds,
    experiment.brandDomain,
    PERCEPTION_CLASSIFIER_VERSION,
  );
  const results: (ExperimentPromptResult & { controlStable: boolean })[] =
    prompts.map((p) => {
      const mine = sort(
        replays.filter((r) => r.promptId === p.id),
        (a, b) => a.arm.localeCompare(b.arm) || a.repeat - b.repeat,
      );
      const arm = (name: ExperimentArm) => mine.filter((r) => r.arm === name);
      const controlFlags = arm("control").map(
        (r) => r.stance === "recommended",
      );
      const readReal = real.filter((r) => r.promptId === p.id);
      return {
        promptId: p.id,
        prompt: p.text,
        topic: p.topic,
        control: tally(arm("control")),
        variant: tally(arm("variant")),
        real: {
          read: readReal.length,
          recommended: readReal.filter(
            (r) => (r.reviewedStance ?? r.stance) === "recommended",
          ).length,
        },
        controlStable: controlFlags.every((f) => f === controlFlags[0]),
        replays: mine.map((r) => ({
          id: r.id,
          promptId: r.promptId,
          arm: r.arm,
          repeat: r.repeat,
          answer: r.answerMarkdown,
          named: r.named,
          stance: r.stance,
          sentiment: r.sentiment,
          evidence: r.evidence,
        })),
      };
    });
  return {
    id: experiment.id,
    title: experiment.title,
    status: experiment.status,
    sourceUrl: experiment.sourceUrl,
    createdAt: experiment.createdAt,
    replayedAt: experiment.replayedAt,
    approvedAt: experiment.approvedAt,
    approvedBy: experiment.approvedBy,
    repeats: experiment.repeats,
    prompts: promptIds.length,
    costUsd: experiment.costUsd,
    originalText: experiment.originalText,
    editedText: experiment.editedText,
    assumptions: experiment.assumptions,
    brand: { name: experiment.brandName, domain: experiment.brandDomain },
    opportunityId: experiment.opportunityId,
    model: experiment.model,
    simulationNote: SIMULATION_NOTE,
    promptResults: results.map(({ controlStable: _s, ...r }) => r),
    verdict: replays.length
      ? experimentVerdict(results, experiment.repeats)
      : null,
  };
}

type ExperimentApprover = "person" | "agent";

function candidateOf(
  experiment: PerceptionExperiment,
  firstPrompt: string,
  now: string,
  by: ExperimentApprover,
): OpportunityCandidate {
  const verdict = experiment.verdict;
  return {
    dedupeKey: `ai_perception_experiment::${experiment.id}`,
    query: firstPrompt,
    pageUrl: experiment.sourceUrl,
    action: experiment.sourceUrl ? "refresh_existing_page" : "create_page",
    reason: `Tested edit: ${experiment.title}. ${verdict?.explanation ?? ""}`,
    matchedCollectionHandle: null,
    dataSource: "ai_visibility",
    intent: null,
    priority: "medium",
    priorityReason: `${by === "agent" ? "Queued by an agent" : "Approved by a person"} after a simulated replay. Not evidence of what an engine will answer.`,
    observedAt: now,
    impressions: 0,
    clicks: 0,
    ctr: 0,
    position: 0,
    windowStart: experiment.replayedAt ?? now,
    windowEnd: experiment.replayedAt ?? now,
    evidence: [
      {
        source: "ai_visibility",
        label: "Experimental, simulated replay",
        value: experiment.simulationNote,
      },
      ...(verdict
        ? [
            {
              source: "ai_visibility",
              label: "Replay result",
              value: verdict.explanation,
            },
          ]
        : []),
      {
        source: "ai_visibility",
        label: "Assumptions",
        value: experiment.assumptions || "None recorded.",
      },
      {
        source: "ai_visibility",
        label: "Proposed page text",
        value: experiment.editedText.slice(0, 1500),
      },
      ...experiment.promptResults.map((p) => ({
        source: "ai_visibility",
        label: "Buyer question",
        value: p.prompt,
      })),
    ],
  };
}

/**
 * Turns a replayed edit into an opportunity for the existing Content Studio
 * flow to draft and publish. Nothing is published here. An agent may queue one
 * only when the replay measured enough repeats to give a verdict.
 */
export async function approveExperiment(
  scope: { projectId: string; organizationId: string },
  id: string,
  by: ExperimentApprover = "person",
) {
  const experiment = await getExperiment(scope.projectId, id);
  if (!experiment) throw new AppError("NOT_FOUND");
  if (experiment.status === "draft")
    throw new AppError(
      "VALIDATION_ERROR",
      "Replay the edit before approving it.",
    );
  if (
    by === "agent" &&
    experiment.verdict?.call !== undefined &&
    experiment.verdict.call === "too_few_repeats"
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "Replay with at least 3 repeats before queueing, so the result has a measured spread.",
    );
  const now = new Date().toISOString();
  const opportunityId = await OpportunityRepository.upsertCandidate(
    scope,
    candidateOf(
      experiment,
      experiment.promptResults[0]?.prompt ?? experiment.title,
      now,
      by,
    ),
  );
  await repo.markApproved({
    id,
    opportunityId,
    approvedAt: now,
    approvedBy: by,
  });
  return { opportunityId };
}
