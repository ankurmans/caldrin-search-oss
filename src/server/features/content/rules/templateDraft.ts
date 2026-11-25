import type { ContentBrief } from "./briefBuilder";
import type { StoreSnapshot } from "./storeTypes";

export type DraftContent = {
  title: string;
  bodyHtml: string;
  metaTitle: string;
  metaDescription: string;
};

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function firstSentence(text: string, max = 200): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const end = cleaned.search(/[.!?](\s|$)/);
  const sentence = end >= 0 ? cleaned.slice(0, end + 1) : cleaned;
  return sentence.length > max
    ? `${sentence.slice(0, max - 1).trimEnd()}…`
    : sentence;
}

// Deterministic structure built only from the brief and the store's own data.
// Where the store holds no facts, it writes a visible placeholder. The
// "no unresolved placeholders" quality check blocks approval until each one is
// filled, so a gap is never papered over with invented text.
export function buildTemplateDraft(
  brief: ContentBrief,
  store: StoreSnapshot,
): DraftContent {
  const sections: string[] = [];
  sections.push(
    `<p>${escapeHtml(brief.title)}: this guide lists what ${escapeHtml(store.shopName)} currently has available and what to check before you choose.</p>`,
  );

  sections.push("<h2>What we have available</h2>");
  if (brief.products.length > 0) {
    const items = brief.products
      .map((product) => {
        const blurb = firstSentence(product.description);
        return `<li><a href="/products/${escapeHtml(product.handle)}">${escapeHtml(product.title)}</a>${blurb ? `: ${escapeHtml(blurb)}` : ""}</li>`;
      })
      .join("");
    sections.push(`<ul>${items}</ul>`);
  } else {
    sections.push(
      "<p>[MERCHANT TO ADD: which products answer this search, and the facts about them.]</p>",
    );
  }

  sections.push("<h2>What to check before you choose</h2>");
  sections.push(
    "<p>[MERCHANT TO ADD: the buying criteria that matter for this search, from your own product knowledge.]</p>",
  );

  for (const handle of brief.collectionHandles) {
    const collection = store.collections.find((c) => c.handle === handle);
    if (collection) {
      sections.push(
        `<p>Browse the full range: <a href="/collections/${escapeHtml(collection.handle)}">${escapeHtml(collection.title)}</a>.</p>`,
      );
    }
  }

  const metaDescription = `${brief.title}: what ${store.shopName} has available and what to check before choosing.`;
  return {
    title: brief.title,
    bodyHtml: sections.join("\n"),
    metaTitle: `${brief.title} | ${store.shopName}`.slice(0, 70),
    metaDescription: metaDescription.slice(0, 160),
  };
}
