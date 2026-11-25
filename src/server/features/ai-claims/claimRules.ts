import { z } from "zod";
import {
  claimCategories,
  claimProposition,
  type ClaimProposition,
} from "@/shared/ai-claims";

export const CLAIM_RECIPE = "claim-extraction-v1";
export const ASSESSMENT_RECIPE = "exact-fact-comparison-v3";
export const MAX_ANSWERS = 20;
export const MAX_ANSWER_CHARS = 12_000;
export const MAX_OUTPUT_TOKENS = 1000;

export const modelClaims = z.object({
  claims: z
    .array(
      claimProposition.extend({
        category: z.enum(claimCategories),
        effectiveDate: z.iso.date().nullable(),
        quote: z.string().min(5).max(500),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(8),
  ambiguous: z.number().int().min(0).max(100),
});

export const normalizeClaimText = (value: string | null) =>
  value?.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase() ?? null;

export function propositionScope(claim: ClaimProposition) {
  return [
    claim.subject,
    claim.predicate,
    claim.plan,
    claim.market,
    claim.product,
    claim.version,
    claim.condition,
  ].map(normalizeClaimText);
}

export const monthlyPricePredicates = [
  "monthly price",
  "monthly subscription price",
  "monthly cost",
  "price per month",
  "cost per month",
];
export const yearlyPricePredicates = [
  "yearly price",
  "annual price",
  "annual subscription price",
  "yearly cost",
  "annual cost",
  "price per year",
];

export function recurringPriceCadence(
  value: string,
  plan: string | null = null,
) {
  let predicate = normalizeClaimText(value) ?? "";
  const planName = normalizeClaimText(plan);
  if (planName) {
    const suffix = [` of ${planName} plan`, ` of the ${planName} plan`].find(
      (candidate) => predicate.endsWith(candidate),
    );
    if (suffix) predicate = predicate.slice(0, -suffix.length);
  }
  if (monthlyPricePredicates.includes(predicate)) return "month";
  if (yearlyPricePredicates.includes(predicate)) return "year";
  return null;
}

function recurringPrice(proposition: ClaimProposition) {
  const cadence = recurringPriceCadence(
    proposition.predicate,
    proposition.plan,
  );
  if (!cadence) return null;

  let value = normalizeClaimText(proposition.value) ?? "";
  const plan = normalizeClaimText(proposition.plan);
  if (plan) {
    for (const suffix of [` for ${plan} plan`, ` for the ${plan} plan`]) {
      if (value.endsWith(suffix)) value = value.slice(0, -suffix.length);
    }
  }

  const match = value.match(
    /^([a-z]{3}) (\d+(?:\.\d{1,2})?)(?: (?:\/|per) (month|year))?$/,
  );
  if (!match || (match[3] && match[3] !== cadence)) return null;
  return { currency: match[1], cadence, amount: Number(match[2]) };
}

export function compareRecurringPrices(
  a: ClaimProposition,
  b: ClaimProposition,
) {
  const price = recurringPrice(a);
  const other = recurringPrice(b);
  if (
    !price ||
    !other ||
    price.cadence !== other.cadence ||
    price.currency !== other.currency
  )
    return null;
  return price.amount === other.amount ? "same" : "different";
}

function assessmentScope(proposition: ClaimProposition) {
  const scope = propositionScope(proposition);
  const cadence = recurringPriceCadence(
    proposition.predicate,
    proposition.plan,
  );
  if (cadence)
    scope[1] = cadence === "month" ? "monthly price" : "yearly price";
  return JSON.stringify(scope);
}

export async function hashClaimInput(input: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(bytes), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export function validateClaims(
  brand: string,
  answer: string,
  output: z.infer<typeof modelClaims>,
) {
  const identity = normalizeClaimText(brand);
  let needsReview = output.ambiguous;
  const claims = [];
  for (const { quote, confidence, ...claim } of output.claims) {
    const start = answer.indexOf(quote);
    if (
      normalizeClaimText(claim.subject) !== normalizeClaimText(brand) ||
      start < 0 ||
      answer.indexOf(quote, start + 1) !== -1 ||
      confidence < 0.6 ||
      !identity ||
      !normalizeClaimText(
        answer.slice(Math.max(0, start - 240), start + quote.length + 240),
      )?.includes(identity)
    ) {
      needsReview++;
      continue;
    }
    claims.push({
      claim,
      confidence,
      start,
      end: start + quote.length,
      key: JSON.stringify([
        CLAIM_RECIPE,
        ...propositionScope(claim),
        normalizeClaimText(claim.value),
        claim.polarity,
        claim.effectiveDate,
      ]),
    });
  }
  return { claims, needsReview };
}

type Fact = ClaimProposition & {
  id: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

export function compareApprovedFacts(
  claim: ClaimProposition & { effectiveDate: string | null },
  observedAt: string | null,
  facts: Fact[],
) {
  const date = claim.effectiveDate ?? observedAt?.slice(0, 10);
  const scope = assessmentScope(claim);
  const matches = date
    ? facts.filter(
        (fact) =>
          fact.effectiveFrom <= date &&
          (!fact.effectiveUntil || date < fact.effectiveUntil) &&
          assessmentScope(fact) === scope,
      )
    : [];
  const claimedValue = normalizeClaimText(claim.value);
  let supports = false;
  let contradicts = false;
  for (const fact of matches) {
    const price = compareRecurringPrices(claim, fact);
    const sameValue =
      normalizeClaimText(fact.value) === claimedValue || price === "same";

    if (sameValue && fact.polarity === claim.polarity) supports = true;
    if (
      (sameValue && fact.polarity !== claim.polarity) ||
      (price === "different" &&
        fact.polarity === "asserts" &&
        claim.polarity === "asserts")
    ) {
      contradicts = true;
    }
  }
  if (supports && contradicts)
    return {
      status: "mixed",
      matches,
      rationale: "Applicable approved facts disagree on this proposition.",
    } as const;
  if (contradicts)
    return {
      status: "conflict",
      matches,
      rationale:
        "An approved fact disagrees on this assertion within the same scope and date. Review both values before confirming.",
    } as const;
  if (supports)
    return {
      status: "consistent",
      matches,
      rationale:
        "An approved fact matches this proposition and its qualifiers.",
    } as const;
  return {
    status: "insufficient",
    matches,
    rationale: matches.length
      ? "Different values need human interpretation. Their disagreement alone does not establish a contradiction."
      : "No approved fact covers this proposition, qualifiers and date.",
  } as const;
}
