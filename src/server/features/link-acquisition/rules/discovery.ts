import * as cheerio from "cheerio";
import { hostOf, readPage } from "./linkVerification";

/** What fetching a page showed. `unverified` means we could not tell. */
export type PageState = "live" | "gone" | "unverified";

export type RecoveryVerdict = {
  outcome:
    | "recover"
    | "review"
    | "already_fixed"
    | "still_linking"
    | "page_gone";
  /** What to do next, in plain words. */
  action: string;
  /** What this check could not confirm. */
  limitation: string | null;
};

function isOwn(host: string | null, own: string) {
  return host !== null && (host === own || host.endsWith(`.${own}`));
}

/**
 * The provider says a link to the project's site has been lost. Fetch the page
 * that carried it: if the link is still there the provider is out of date, if
 * the page is gone it cannot come back, and if the page is live without the
 * link the site removed it, which is worth asking about.
 */
export function classifyLostLink(input: {
  linkingPage: PageState;
  html: string | null;
  finalUrl: string;
  own: string;
  target: PageState;
}): RecoveryVerdict {
  if (input.linkingPage === "gone") {
    return {
      outcome: "page_gone",
      action: "The page that linked to you no longer exists.",
      limitation: null,
    };
  }
  if (input.linkingPage === "unverified" || input.html === null) {
    return {
      outcome: "review",
      action:
        "Open the page and check whether it still links to you before writing.",
      limitation:
        "The linking page could not be fetched, so the provider's lost-link report is unconfirmed.",
    };
  }
  const stillLinks = readPage(input.html, input.finalUrl).links.some(
    (link) => !link.hidden && isOwn(hostOf(link.href), input.own),
  );
  if (stillLinks) {
    return {
      outcome: "still_linking",
      action: "The page still links to you; the provider data is out of date.",
      limitation: null,
    };
  }
  return {
    outcome: "recover",
    action:
      input.target === "gone"
        ? "The link was removed and the page it pointed to is also gone. Redirect or restore that page first, then ask the site to restore the link."
        : "The link was removed from a live page. Ask the site to restore it, pointing at the page it linked to.",
    limitation:
      input.target === "unverified"
        ? "The page the link pointed to could not be fetched."
        : null,
  };
}

/**
 * The provider says a link points at a page that no longer works. The fix is
 * on the project's own site, so what matters is whether that page is still
 * broken when fetched now.
 */
export function classifyBrokenLink(input: {
  target: PageState;
}): RecoveryVerdict {
  if (input.target === "live") {
    return {
      outcome: "already_fixed",
      action: "The page works now; the provider data is out of date.",
      limitation: null,
    };
  }
  if (input.target === "unverified") {
    return {
      outcome: "review",
      action: "Open the page and check whether it is really broken.",
      limitation:
        "The page could not be fetched, so the provider's broken-link report is unconfirmed (some sites refuse automated requests).",
    };
  }
  return {
    outcome: "recover",
    action:
      "Redirect the dead page to the closest live page or restore it. The existing link then counts again, with no outreach needed.",
    limitation: null,
  };
}

type MentionResult =
  | { kind: "unlinked"; snippet: string; term: string }
  | { kind: "linked"; term: string }
  | { kind: "not_mentioned" };

const SNIPPET_CHARS = 140;

/**
 * Whether a fetched page names the brand in its text and whether it links to
 * the project's site anywhere. Only text a reader sees counts; script and
 * style text does not, and a link in the page means the mention is not
 * unlinked.
 */
export function findMention(input: {
  html: string;
  finalUrl: string;
  terms: string[];
  own: string;
}): MentionResult {
  const $ = cheerio.load(input.html);
  $("script,style,noscript,template,head").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  for (const term of input.terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(
      `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
      "iu",
    ).exec(text);
    if (!match) continue;
    const linked = readPage(input.html, input.finalUrl).links.some(
      (link) => !link.hidden && isOwn(hostOf(link.href), input.own),
    );
    if (linked) return { kind: "linked", term };
    const start = Math.max(0, match.index - SNIPPET_CHARS);
    const end = match.index + term.length + SNIPPET_CHARS;
    return {
      kind: "unlinked",
      term,
      snippet: text.slice(start, end).trim(),
    };
  }
  return { kind: "not_mentioned" };
}

/** Terms to look for: the brand name and the bare domain, without duplicates. */
export function mentionTerms(brand: string | null, ownDomain: string) {
  const terms = [brand?.trim(), ownDomain].filter(
    (value): value is string => !!value && value.length >= 3,
  );
  return [...new Set(terms.map((term) => term.toLowerCase()))];
}
