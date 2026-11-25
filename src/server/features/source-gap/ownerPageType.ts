import type { ParsedPage } from "@/shared/source-gap";
import type { OwnerPageType } from "@/shared/source-gap-owner";
import { readPageContent } from "./pagePurpose";
import {
  asksAboutCost,
  isBuyerIntent,
  isCommercialPrompt,
  isComparativePrompt,
} from "./pageSignals";

const HOW_TO = /\bhow[- ]to\b|\b(tutorial|walkthrough|step[- ]by[- ]step)\b/;
const HOW_TO_PATH = /\/(guides?|tutorials?|how-to|learn)\//;
const COMPARISON =
  /\b(best|top|vs|versus|alternatives?|compare[sd]?|comparison|reviews?)\b/;
const PRICING = /\b(pricing|plans)\b/;

const HOW_TO_PROMPT =
  /^\s*how (do|can|should|to)\b|\b(steps? to|tutorial|walkthrough)\b/i;

/** What the person asking wants: to choose between products, or to learn to do something. */
export function promptWants(
  prompt: string,
  intent: string | null,
): "buy" | "how_to" | null {
  if (isBuyerIntent(intent, prompt)) return "buy";
  return HOW_TO_PROMPT.test(prompt) ? "how_to" : null;
}

/**
 * What kind of page this is. A page that has been read is judged on its body:
 * how many products it sets side by side and whether it helps a reader choose.
 * A page not read yet is judged on its address and its title and H1, which is
 * only a first guess; a title that says "best" proves nothing about the page.
 */
export function ownerPageType(
  url: string,
  heading: string,
  page: ParsedPage | null,
): OwnerPageType {
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    // Judge on the heading alone.
  }
  const words = `${path.replace(/[-_/.]+/g, " ")} ${heading.toLowerCase()}`;
  if (page) {
    if (page.pageKind === "pricing" || PRICING.test(path)) return "pricing";
    const { purpose } = readPageContent(page);
    if (purpose !== "unknown") return purpose;
    if (HOW_TO.test(words) || HOW_TO_PATH.test(path)) return "how_to";
    return "unknown";
  }
  if (HOW_TO.test(words) || HOW_TO_PATH.test(path)) return "how_to";
  if (PRICING.test(path)) return "pricing";
  if (COMPARISON.test(words)) return "comparison";
  if (PRICING.test(heading.toLowerCase())) return "pricing";
  return "unknown";
}

/**
 * How well a page's type fits what the prompt asks for, 0 to 1, or null when
 * the type says nothing either way. A buyer's question wants a comparison or
 * pricing page, not a how-to guide.
 */
export function pageTypeFit(
  wants: "buy" | "how_to" | null,
  type: OwnerPageType,
  prompt: string,
  intent: string | null,
): number | null {
  if (wants === "buy") {
    // A question about what one thing costs is answered by its price list;
    // a roundup of several products is a lesser answer to it.
    if (type === "comparison")
      return asksAboutCost(prompt) && !isComparativePrompt(prompt, intent)
        ? 0.6
        : 1;
    if (type === "pricing") return isCommercialPrompt(prompt, intent) ? 1 : 0.6;
    if (type === "how_to") return 0;
    // One product's page cannot say which of several to choose, whatever its
    // title claims; it can still answer a question about what that product costs.
    if (type === "product")
      return isComparativePrompt(prompt, intent) ? 0.1 : 0.6;
    return null;
  }
  if (wants === "how_to") {
    if (type === "how_to") return 1;
    if (type === "comparison") return 0.3;
    if (type === "pricing") return 0.2;
    if (type === "product") return 0.2;
  }
  return null;
}
