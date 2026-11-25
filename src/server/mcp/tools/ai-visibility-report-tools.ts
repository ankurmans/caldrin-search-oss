import { z } from "zod";
import { defineAiTool } from "./ai-visibility-tool-factory";
import { aiIntelligenceSchema } from "@/types/schemas/ai-visibility-intelligence";
import { citationGapSchema } from "@/types/schemas/citation-gaps";
import {
  aiInsightsOutput,
  aiCitationGapsOutput,
  aiRankedActionsOutput,
  aiReportOutput,
} from "./ai-visibility-output-schemas";

export const getAiVisibilityInsightsTool = defineAiTool({
  name: "get_ai_visibility_insights",
  title: "Get AI visibility insights",
  input: aiIntelligenceSchema,
  output: aiInsightsOutput,
  readOnly: true,
  description:
    "The Visibility Insights scorecard from stored answers: a leaderboard of your brand and tracked competitors with visibility, share of voice, average position, mention and citation rates, per-engine visibility, coverage, the repeat-run noise note, and a collection-day trend. Filter by days (7, 28, 90), engines, topic, branded, intents, or competitors. Reads stored answers only and uses no credits. For a ready-to-share document, use get_ai_visibility_report; for the pages behind the numbers, use get_citation_gaps.",
  execute: (s, a) => s.getIntelligence(a),
  summarize: (d) => {
    const t = d.target;
    return `Visibility Insights, last ${d.window.days} days: ${d.coverage.answered}/${d.coverage.planned} answers, ${d.brandsCompared} brands compared.${t ? ` Your brand ranks ${t.rank ?? "n/a"} with ${t.mention.numerator}/${t.mention.denominator} answers naming it.` : ""} ${d.repeatRuns.note}`;
  },
});

export const getCitationGapsTool = defineAiTool({
  name: "get_citation_gaps",
  title: "Get citation gaps",
  input: citationGapSchema,
  output: aiCitationGapsOutput,
  readOnly: true,
  description:
    "Citation Gaps from stored answers: prioritized findings (missing content on your site, missing comparison coverage, missing independent corroboration, third-party sources to pursue) with the prompts, competitors, cited sources and answer IDs behind each, plus every cited source domain classed as yours, a competitor's, or a third party's. Filter by days (7, 28, 90), engines, or topic. Reads stored answers only and uses no credits. A citation shows an engine used a page, not that the page endorses any brand. Read an answer with get_ai_visibility_answer.",
  execute: async (s, a) => {
    const { analyzeCitationGaps } =
      await import("@/server/features/citation-gaps/citationGapService");
    return analyzeCitationGaps(a);
  },
  summarize: (d) =>
    `Citation Gaps, last ${d.window.days} days: ${d.findings.length} findings, ${d.sources.length} cited sources, ${d.coverage.answered}/${d.coverage.planned} answers.`,
});

export const getAiObservedProductsTool = defineAiTool({
  name: "get_ai_observed_products",
  title: "Get products AI engines showed",
  input: citationGapSchema,
  output: z.looseObject({
    window: z.looseObject({ days: z.number() }),
    coverage: z.looseObject({
      answered: z.number(),
      answeredWithProducts: z.number(),
    }),
    products: z.array(z.looseObject({ name: z.string(), answers: z.number() })),
    notes: z.array(z.string()),
  }),
  readOnly: true,
  description:
    "Products that AI engines showed as product cards in stored answers, grouped by title with how many answers listed each, the engines, average position, price range and tags the engine gave. Only the ChatGPT scraper reports product cards, and it gives title, price, currency and tag only: no merchant, link or rating. Counts are out of answers that showed any cards. Filter by days (7, 28, 90), engines, or topic. Reads stored answers only and uses no credits.",
  execute: async (s, a) => {
    const { getObservedProducts } =
      await import("@/server/features/ai-visibility/services/aiObservedProducts");
    return getObservedProducts(a);
  },
  summarize: (d) =>
    `${d.products.length} products shown in ${d.coverage.answeredWithProducts} of ${d.coverage.answered} answers, last ${d.window.days} days.`,
});

export const getRankedActionsTool = defineAiTool({
  name: "get_ranked_actions",
  title: "Get ranked actions",
  input: citationGapSchema,
  output: aiRankedActionsOutput,
  readOnly: true,
  description:
    "The citation-gap findings that are actions, ranked by priority, then lowest effort, then evidence, and split into owned work (pages and fixes on your site) and earned work (coverage someone else publishes). Each action names its prompt group and finding key; store one with create_gap_opportunity using its findingKey, or read its prompts and sources with get_citation_gaps. An action already stored as an opportunity also shows how often answers in its prompt group named you before and after it was stored, as an observation only: nothing shows the work caused a change. Filter by days (7, 28, 90), engines, or topic. Reads stored answers only and uses no credits.",
  execute: async (s, a) => {
    const { rankCitationActions } =
      await import("@/server/features/citation-gaps/citationGapService");
    return rankCitationActions(a);
  },
  summarize: (d) => {
    const owned = d.actions.filter((a) => a.kind === "owned").length;
    return `Ranked actions, last ${d.window.days} days: ${d.actions.length} (${owned} owned, ${d.actions.length - owned} earned).`;
  },
});

export const getAiVisibilityReportTool = defineAiTool({
  name: "get_ai_visibility_report",
  title: "Get AI visibility report (Markdown)",
  input: aiIntelligenceSchema,
  output: aiReportOutput,
  readOnly: true,
  description:
    "One self-contained Markdown report of a project's AI visibility from stored answers: caveats and sample size, the tracked prompts and brands, the Visibility Insights leaderboard with per-engine visibility, Citation Gaps with suggested actions, and the top cited sources. Hand it to an SEO agent or paste it into a document. Filter by days (7, 28, 90), engines, or topic. Reads stored answers only and uses no credits. The full Markdown is in data.markdown.",
  execute: async (s, a) => {
    const [{ analyzeCitationGaps }, { buildAiVisibilityReportMarkdown }] =
      await Promise.all([
        import("@/server/features/citation-gaps/citationGapService"),
        import("@/server/features/ai-visibility/services/aiVisibilityReportMarkdown"),
      ]);
    const [tracker, intelligence, gaps] = await Promise.all([
      s.getTracker(a),
      s.getIntelligence(a),
      analyzeCitationGaps({
        projectId: a.projectId,
        days: a.days,
        engines: a.engines,
        topic: a.topic,
      }),
    ]);
    const own = tracker.brands.find((b) => b.own);
    return {
      markdown: buildAiVisibilityReportMarkdown({
        project: {
          name: own?.name ?? "Project",
          domain: own?.domain ?? "unknown",
        },
        tracker,
        intelligence,
        gaps,
        generatedAt: new Date(),
      }),
    };
  },
  // The text is the report itself, so a client that shows only text still gets it.
  summarize: (d) => d.markdown,
});
