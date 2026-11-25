import { sortBy, unique } from "remeda";
import type { EnsuredProject } from "@/middleware/ensure-user/types";
import { AiVisibilityRepository } from "@/server/features/ai-visibility/repositories/AiVisibilityRepository";
import { KeywordResearchRepository } from "@/server/features/keywords/repositories/KeywordResearchRepository";
import { KeywordSuggestionService } from "@/server/features/keywords/services/KeywordSuggestionService";
import { research } from "@/server/features/keywords/services/research";
import { normalizeKeyword } from "@/server/features/keywords/services/research/helpers";
import type { CustomerContext } from "@/server/lib/customer-context";
import { AppError } from "@/server/lib/errors";

// Each seed is one paid research, so the number of seeds is the cost.
const MAX_SEEDS = 5;
// A longer topic drifts off topic when expanded, as in suggested searches.
const MAX_SEED_WORDS = 3;
const MIN_VOLUME = 10;
const MAX_IDEAS = 100;
// Before the saved check, which costs a query per 80 keywords.
const MAX_CANDIDATES = 200;

/**
 * Keyword ideas for a project, with volume, difficulty and CPC, from the
 * topics saved for its website (generated first when it has none). Nothing is
 * saved: a person picks which ideas to keep.
 */
async function seed(project: EnsuredProject, customer: CustomerContext) {
  let topics = await AiVisibilityRepository.listResearchKeywords(project.id);
  if (!topics.length) {
    await KeywordSuggestionService.generate(project, customer);
    topics = await AiVisibilityRepository.listResearchKeywords(project.id);
  }
  const seeds = unique(topics.map(normalizeKeyword))
    .filter((topic) => topic.split(/\s+/).length <= MAX_SEED_WORDS)
    .slice(0, MAX_SEEDS);
  if (!seeds.length)
    throw new AppError(
      "VALIDATION_ERROR",
      "We couldn't find topics for this project. Check the website in project settings.",
    );

  const market = {
    locationCode: project.locationCode,
    languageCode: project.languageCode,
  };
  // Settled, so one seed failing keeps the ideas the others paid for.
  const results = await Promise.allSettled(
    seeds.map((keyword) =>
      research(
        {
          projectId: project.id,
          keywords: [keyword],
          ...market,
          resultLimit: 150,
          mode: "auto",
          clickstream: false,
          groupKeywords: true,
        },
        customer,
      ),
    ),
  );
  const answered = results.filter((r) => r.status === "fulfilled");
  if (!answered.length) {
    const failed = results.find((r) => r.status === "rejected");
    throw failed?.reason ?? new AppError("INTERNAL_ERROR");
  }

  const candidates = sortBy(
    [
      ...new Map(
        answered
          .flatMap((r) => r.value.rows)
          .filter((row) => (row.searchVolume ?? 0) >= MIN_VOLUME)
          .map((row) => [row.keyword, row]),
      ).values(),
    ],
    [(row) => row.searchVolume ?? 0, "desc"],
  ).slice(0, MAX_CANDIDATES);
  const saved = new Set(
    (
      await KeywordResearchRepository.listSavedKeywordRowsByKeywords({
        projectId: project.id,
        keywords: candidates.map((row) => row.keyword),
        ...market,
      })
    ).map((row) => row.keyword),
  );
  return {
    seeds,
    keywords: candidates
      .filter((row) => !saved.has(row.keyword))
      .slice(0, MAX_IDEAS),
  };
}

export const KeywordSeedService = { seed };
