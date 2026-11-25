import {
  fetchSourcePage,
  type FetchDeps,
} from "@/server/features/source-gap/sourcePageFetcher";
import { extractPage } from "@/server/features/source-gap/pageExtractor";

type LoadedExperimentPage =
  | {
      ok: true;
      url: string;
      title: string | null;
      /** The page's visible text, one block per line. */
      text: string;
      wordCount: number;
    }
  | { ok: false; reason: string };

/**
 * Reads a public page's visible text so an experiment starts from what is
 * live instead of a pasted copy. It uses the same fetcher as source analysis:
 * public addresses only, redirects checked, robots.txt respected.
 */
export async function loadExperimentPage(
  url: string,
  deps: FetchDeps = {},
): Promise<LoadedExperimentPage> {
  const page = await fetchSourcePage(url, { ...deps, allowHomepage: true });
  if (page.status !== "ok" || !page.html)
    return {
      ok: false,
      reason: page.note ?? "The page could not be read.",
    };
  const parsed = extractPage(page.html, page.finalUrl);
  if (!parsed.text.trim())
    return {
      ok: false,
      reason:
        "The page has no readable text. It may be built in the browser, so paste its text instead.",
    };
  return {
    ok: true,
    url: parsed.canonical ?? page.finalUrl,
    title: parsed.title,
    text: parsed.text,
    wordCount: parsed.wordCount,
  };
}
