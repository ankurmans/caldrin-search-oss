import type { LinkCampaignMode } from "@/shared/link-acquisition";

/** A linking page the draft may refer to, exactly as recorded. */
export type DraftEvidence = {
  urlFrom: string;
  pageTitle: string | null;
  anchor: string | null;
  competitorDomain: string | null;
  isSponsored: boolean;
};

export type DraftInput = {
  mode: LinkCampaignMode;
  brandName: string;
  referringDomain: string;
  // Their page we are writing about, when a person gave one.
  pageUrl: string | null;
  evidence: DraftEvidence[];
  targetUrl: string;
  contactName: string | null;
};

const PLACEHOLDER = /\[\[[^\]]+\]\]/;

/** True when the text still has a placeholder a person has to fill in. */
export function hasPlaceholder(text: string) {
  return PLACEHOLDER.test(text);
}

function referenceLine(input: DraftInput): string | null {
  const first = input.evidence[0];
  if (first) {
    const competitors = [
      ...new Set(
        input.evidence
          .map((item) => item.competitorDomain)
          .filter((value): value is string => !!value),
      ),
    ];
    const title = first.pageTitle ? `"${first.pageTitle}"` : first.urlFrom;
    const linked =
      competitors.length > 0
        ? ` It links to ${competitors.join(" and ")}.`
        : "";
    return `I found your page ${title} (${first.urlFrom}).${linked}`;
  }
  if (input.pageUrl) return `I am writing about your page ${input.pageUrl}.`;
  return null;
}

/**
 * Writes a plain draft from facts on record: the page found, the competitors
 * it links to, and the page we want linked. It states nothing about the
 * recipient that was not recorded, never claims past contact, and addresses a
 * person by name only when one was entered. Returns null when there is no real
 * page to refer to, because a draft with nothing real to say would have to
 * invent something.
 */
export function buildDraft(
  input: DraftInput,
): { subject: string; body: string } | null {
  const reference = referenceLine(input);
  if (!reference) return null;
  const greeting = input.contactName ? `Hi ${input.contactName},` : "Hello,";
  const sign = input.brandName;
  if (input.mode === "sponsored_distribution") {
    return {
      subject: `Sponsored placement inquiry: ${input.brandName}`,
      body: [
        greeting,
        "",
        reference,
        "",
        `I would like to ask whether ${input.referringDomain} offers sponsored or paid placements, and on what terms. The page I would want to feature is ${input.targetUrl}.`,
        "",
        "Any placement would be disclosed and marked as sponsored (rel=sponsored).",
        "",
        "Thank you,",
        sign,
      ].join("\n"),
    };
  }
  if (input.mode === "partnership") {
    return {
      subject: `Working together: ${input.brandName} and ${input.referringDomain}`,
      body: [
        greeting,
        "",
        reference,
        "",
        `I run ${input.brandName} and would like to explore working together. One page that may be relevant to your readers is ${input.targetUrl}.`,
        "",
        "If a partnership or a reference to it makes sense for you, I would be glad to talk about what would be useful on your side.",
        "",
        "Thank you,",
        sign,
      ].join("\n"),
    };
  }
  return {
    subject: `A resource for your readers: ${input.brandName}`,
    body: [
      greeting,
      "",
      reference,
      "",
      `I work on ${input.brandName}. If it fits your page, this may be a useful addition for your readers: ${input.targetUrl}.`,
      "",
      "If it is not a fit, no problem, and thank you for reading.",
      "",
      sign,
    ].join("\n"),
  };
}
