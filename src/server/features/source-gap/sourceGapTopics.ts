import type { SourceGapAnalysis, TopicSourceGap } from "@/shared/source-gap";

/**
 * Prompts of one topic side by side. Each pattern lists the prompts it was
 * found for; prompts with different intents are never merged into one
 * recommendation, so the reader decides what they share.
 */
export function topicOverview(
  prompts: { id: string; text: string; topic: string }[],
  analyses: SourceGapAnalysis[],
): TopicSourceGap[] {
  const byPrompt = new Map(analyses.map((a) => [a.promptId, a]));
  const topics = new Map<string, TopicSourceGap>();
  for (const prompt of prompts) {
    const topic =
      topics.get(prompt.topic) ??
      ({
        topic: prompt.topic,
        prompts: 0,
        analyzed: 0,
        answers: 0,
        competitorMentionsWithoutYou: 0,
        competitorOwnedCitations: 0,
        patterns: [],
      } satisfies TopicSourceGap);
    topic.prompts++;
    const analysis = byPrompt.get(prompt.id);
    if (analysis) {
      topic.analyzed++;
      topic.answers += analysis.stats.answers;
      topic.competitorMentionsWithoutYou +=
        analysis.stats.answersWithCompetitorOnly;
      topic.competitorOwnedCitations += analysis.sources
        .filter((s) => s.sourceType === "competitor_owned")
        .reduce((n, s) => n + s.answers, 0);
      for (const cause of analysis.rootCauses) {
        let pattern = topic.patterns.find((p) => p.category === cause.category);
        if (!pattern) {
          pattern = {
            category: cause.category,
            prompts: [],
          };
          topic.patterns.push(pattern);
        }
        pattern.prompts.push({ promptId: prompt.id, prompt: prompt.text });
      }
    }
    topics.set(prompt.topic, topic);
  }
  const out = [...topics.values()];
  for (const topic of out)
    topic.patterns.sort((a, b) => b.prompts.length - a.prompts.length);
  return out;
}
