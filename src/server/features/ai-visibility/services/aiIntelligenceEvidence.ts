import { aiMarketQuery } from "@/shared/ai-market";
import type {
  IntelEvidencePage,
  IntelPromptEvidence,
} from "@/shared/ai-visibility-intelligence";
import type { AiEvidencePageInput } from "@/types/schemas/ai-visibility-intelligence";
import { AiIntelligenceEvidenceRepository as evidenceRepo } from "../repositories/aiIntelligenceEvidenceRepository";
import { selectIntelRuns } from "./aiVisibilityIntelligence";
import { groupInto } from "./aiVisibilityIntelligenceMetrics";

const ANSWERS_PER_PROMPT = 12;

/**
 * One page of the prompts behind the Insights figures for one brand: the same
 * runs and filters as the scorecard, with per-engine counts worked out in SQL
 * and the newest answers of each prompt. Pages follow topic, text, id order,
 * so the cursor stays stable as later pages are read.
 */
export async function loadAiEvidencePage(
  input: AiEvidencePageInput,
): Promise<IntelEvidencePage> {
  const { selectedRuns, selectedVersionId } = await selectIntelRuns(input);
  if (
    !selectedRuns.length ||
    input.engines?.length === 0 ||
    input.intents?.length === 0
  )
    return { brandDomain: input.brand ?? null, prompts: [], nextCursor: null };
  const scope = {
    projectId: input.projectId,
    promptSetVersionId: selectedVersionId,
    // Newest first, so the last run is the oldest.
    from: selectedRuns[selectedRuns.length - 1].createdAt,
    to: selectedRuns[0].createdAt,
    market: aiMarketQuery(input),
  };
  const domain = input.brand ?? (await evidenceRepo.ownDomain(scope));
  if (!domain) return { brandDomain: null, prompts: [], nextCursor: null };
  const filters = {
    engines: input.engines ?? null,
    topic: input.topic ?? null,
    branded: input.branded,
    intents: input.intents ?? null,
  };
  const found = await evidenceRepo.listPrompts(
    scope,
    filters,
    domain,
    input.cursor ?? null,
    input.limit + 1,
  );
  const page = found.slice(0, input.limit);
  const ids = page.map((p) => p.promptId);
  const [counts, answers] = await Promise.all([
    evidenceRepo.engineCounts(scope, filters, domain, ids),
    evidenceRepo.recentAnswers(scope, filters, domain, ids, ANSWERS_PER_PROMPT),
  ]);
  const countsOf = groupInto(counts, (c) => c.promptId);
  const answersOf = groupInto(answers, (a) => a.promptId);
  const prompts = page.map(
    (prompt): IntelPromptEvidence => ({
      ...prompt,
      engines: (countsOf.get(prompt.promptId) ?? []).map(
        ({ promptId: _, ...engine }) => engine,
      ),
      answers: (answersOf.get(prompt.promptId) ?? []).map(
        ({ promptId: _, answerRank: __, recommended, ...answer }) => ({
          ...answer,
          recommended: recommended === null ? null : Boolean(recommended),
        }),
      ),
    }),
  );
  const last = page.at(-1);
  return {
    brandDomain: domain,
    prompts,
    nextCursor:
      found.length > input.limit && last
        ? { topic: last.topic, prompt: last.prompt, promptId: last.promptId }
        : null,
  };
}
