import { SpendService } from "@/server/features/spend/services/SpendService";
import type { SpendScope } from "@/server/features/spend/types";
import { withResearchAdmission } from "@/server/features/workspace/researchSpend";
import type { CustomerContext } from "@/server/lib/customer-context";
import { readPages } from "@/server/lib/scrape";
import {
  TINYFISH_USD_PER_CREDIT,
  type RenderUsage,
} from "@/shared/audit-rendering";
import { SourceIntelligenceRepository as repo } from "../repositories/SourceIntelligenceRepository";
import { SourcePageAnalysisRepository } from "../repositories/SourcePageAnalysisRepository";
import { SourceActionRefusal } from "../rules/sourceOpportunity";
import { findMentions, MAX_PAGE_CHARS } from "../rules/sourcePageRules";
import { readPageText } from "./pageReader";
import {
  loadSourceAnalysis,
  type SourcePageAnalysis,
} from "./sourceAnalysisRead";
import { loadSourceDetail } from "./SourceIntelligenceService";

// A reading is reused for this long. Reading again is a new, paid request.
const FRESH_DAYS = 30;
// One short model call (about 3k tokens in, 1.5k out) plus a few fallback page
// credits. A ceiling for the limit check; the recorded cost is the measured one.
const PAGE_READING_ESTIMATED_USD = 0.05;

type AnalyseResult =
  | {
      status: "preview";
      estimatedUsd: number;
      basis: string;
      existing: SourcePageAnalysis | null;
    }
  | { status: "done"; analysis: SourcePageAnalysis; costUsd: number };

/**
 * Reads one source page and describes it. Only pages that appeared in this
 * project's AI answers are read, so a caller cannot point the reader at any
 * address. Without `confirm` nothing is fetched or charged.
 */
export async function analyseSourcePage(
  customer: CustomerContext & { projectId: string },
  scope: SpendScope,
  input: { url: string; confirm: boolean; refresh: boolean },
): Promise<AnalyseResult> {
  const { projectId } = scope;
  const { row } = await loadSourceDetail(
    projectId,
    { days: 365, hideDismissed: false },
    input.url,
  );
  if (!row)
    throw new SourceActionRefusal(
      "This page is not in this project's AI answers, so it will not be read.",
    );
  if (row.brand === "own")
    throw new SourceActionRefusal(
      "This page is on your own site. Use Citation gaps for your own pages.",
    );

  const stored = await loadSourceAnalysis(projectId, input.url);
  const fresh =
    stored !== null &&
    Date.now() - Date.parse(stored.analysedAt) < FRESH_DAYS * 86_400_000;
  if (fresh && !input.refresh)
    return { status: "done", analysis: stored, costUsd: 0 };
  if (!input.confirm)
    return {
      status: "preview",
      estimatedUsd: PAGE_READING_ESTIMATED_USD,
      basis:
        "Reads this one page and runs one short AI summary. This is a ceiling; the recorded cost is what the provider reports.",
      existing: stored,
    };

  await SpendService.assertWithinLimits(scope, {
    estimatedUsd: PAGE_READING_ESTIMATED_USD,
    provider: "llm",
    operation: "source_page_analysis",
  });
  const usage: RenderUsage = { cloudflareAttempts: 0, tinyfishCredits: 0 };
  const { page, reading, costUsd } = await withResearchAdmission(
    customer,
    async () => {
      const read = await readPages([input.url], 1, usage, MAX_PAGE_CHARS);
      const first = read.pages[0];
      if (!first)
        throw new SourceActionRefusal(
          "This page could not be read. It may block automated readers or need a login.",
        );
      const result = await readPageText({
        title: first.title,
        text: first.text.slice(0, MAX_PAGE_CHARS),
      }).catch((error: unknown) => {
        throw new SourceActionRefusal(
          error instanceof Error && error.message.includes("AI provider")
            ? error.message
            : "The AI provider could not read this page. Check your key in Settings.",
        );
      });
      return { page: first, ...result };
    },
  );

  const brands = await repo.brands(projectId);
  const own = brands.filter((b) => b.own);
  const competitors = brands.filter((b) => !b.own);
  const namesBrand = findMentions(page.text, own).length > 0;
  const totalCostUsd =
    costUsd + usage.tinyfishCredits * TINYFISH_USD_PER_CREDIT;
  await SourcePageAnalysisRepository.replace(
    {
      id: crypto.randomUUID(),
      projectId,
      url: input.url,
      title: page.title,
      summary: reading.summary,
      pageKind: reading.pageKind,
      namesBrand,
      model: null,
      costUsd: totalCostUsd,
      analysedAt: new Date().toISOString(),
    },
    [
      ...reading.buyerQuestions.map((text) => ({
        kind: "buyer_question" as const,
        text,
      })),
      ...findMentions(page.text, competitors).map((text) => ({
        kind: "competitor_named" as const,
        text,
      })),
      ...reading.datedFacts.map((text) => ({
        kind: "dated_fact" as const,
        text,
      })),
    ],
  );
  await SpendService.recordCost(scope, {
    provider: "llm",
    operation: "source_page_analysis",
    estimatedUsd: PAGE_READING_ESTIMATED_USD,
    costUsd: totalCostUsd,
  });
  const analysis = await loadSourceAnalysis(projectId, input.url);
  if (!analysis) throw new Error("The reading was not saved.");
  return { status: "done", analysis, costUsd: totalCostUsd };
}
