import type {
  PerceptionComparisonOutcome,
  PerceptionSentiment,
  PerceptionStance,
} from "@/shared/ai-perception";

// Answers written for the quality gate and labelled by hand, one expected
// reading per named brand. They are not collected from any customer. Each case
// names the hard thing it tests, so a failure says what the classifier missed.

const N = {
  name: "Northwind Outfitters",
  domain: "northwind.example",
  own: true,
};
const S = { name: "Summit Gear", domain: "summitgear.example", own: false };
const T = { name: "TrailCo", domain: "trailco.example", own: false };
const A = { name: "acme.com", domain: "acme.com", own: true };

interface GoldBrand {
  domain: string;
  stance: PerceptionStance;
  sentiment: PerceptionSentiment;
  /** Outcome of this brand against the named competitor, when the answer sets one. */
  versus?: { domain: string; outcome: PerceptionComparisonOutcome };
}

interface GoldCase {
  id: string;
  tests: string;
  text: string;
  brands: (typeof N)[];
  expected: GoldBrand[];
}

const brand = (
  domain: string,
  stance: PerceptionStance,
  sentiment: PerceptionSentiment,
  versus?: GoldBrand["versus"],
): GoldBrand => ({ domain, stance, sentiment, versus });

export const GOLD_SET: GoldCase[] = [
  {
    id: "explicit-pick",
    tests: "an explicit recommendation",
    text: "For a first tent I recommend Northwind Outfitters. Their Basecamp 2 is light, well made and fairly priced.",
    brands: [N],
    expected: [brand(N.domain, "recommended", "positive")],
  },
  {
    id: "listed-only",
    tests: "a brand listed with no verdict",
    text: "Popular outdoor retailers include Summit Gear, Northwind Outfitters and TrailCo. Each ships nationwide.",
    brands: [N, S, T],
    expected: [
      brand(N.domain, "described", "neutral"),
      brand(S.domain, "described", "neutral"),
      brand(T.domain, "described", "neutral"),
    ],
  },
  {
    id: "advised-against",
    tests: "advice against a brand",
    text: "I would not buy from Summit Gear right now. Reviews report late deliveries and unanswered support emails. Northwind Outfitters is the safer choice.",
    brands: [N, S],
    expected: [
      brand(N.domain, "recommended", "positive", {
        domain: S.domain,
        outcome: "preferred",
      }),
      brand(S.domain, "discouraged", "negative", {
        domain: N.domain,
        outcome: "not_preferred",
      }),
    ],
  },
  {
    id: "negated-praise",
    tests: "negation that reverses a positive word",
    text: "Northwind Outfitters is not cheap and its sleeping bags are not the warmest on the market. Summit Gear is the better pick for winter camping.",
    brands: [N, S],
    expected: [
      brand(N.domain, "described", "negative", {
        domain: S.domain,
        outcome: "not_preferred",
      }),
      brand(S.domain, "recommended", "positive", {
        domain: N.domain,
        outcome: "preferred",
      }),
    ],
  },
  {
    id: "negated-complaint",
    tests: "negation that reverses a complaint",
    text: "Customers have no complaints about TrailCo's returns, and its boots are not bad at all for the price. Northwind Outfitters is also worth a look.",
    brands: [N, T],
    expected: [
      brand(T.domain, "described", "positive"),
      brand(N.domain, "described", "neutral"),
    ],
  },
  {
    id: "mixed",
    tests: "praise and criticism of the same brand",
    text: "Northwind Outfitters makes excellent packs, but its customer service is slow and its prices are high. It suits buyers who value durability over speed.",
    brands: [N],
    expected: [brand(N.domain, "described", "mixed")],
  },
  {
    id: "recommended-with-caveat",
    tests: "a recommendation that carries a weakness",
    text: "Overall I would recommend Northwind Outfitters for hikers, although the larger sizes tend to run out of stock in summer.",
    brands: [N],
    expected: [brand(N.domain, "recommended", "mixed")],
  },
  {
    id: "competitor-preferred",
    tests: "a competitor preferred, own brand only mentioned",
    text: "If budget matters most, TrailCo wins on price. Northwind Outfitters has a similar range, but costs more.",
    brands: [N, T],
    expected: [
      brand(N.domain, "described", "neutral", {
        domain: T.domain,
        outcome: "not_preferred",
      }),
      brand(T.domain, "recommended", "positive", {
        domain: N.domain,
        outcome: "preferred",
      }),
    ],
  },
  {
    id: "equal",
    tests: "two brands presented as equal",
    text: "Northwind Outfitters and Summit Gear are equally good for day packs; pick whichever is closer to you.",
    brands: [N, S],
    expected: [
      brand(N.domain, "described", "positive", {
        domain: S.domain,
        outcome: "equal",
      }),
      brand(S.domain, "described", "positive", {
        domain: N.domain,
        outcome: "equal",
      }),
    ],
  },
  {
    id: "alternative-to",
    tests: "a brand named only as an alternative",
    text: "Summit Gear is the market leader. If you want an alternative, Northwind Outfitters sells similar gear.",
    brands: [N, S],
    expected: [
      brand(N.domain, "described", "neutral"),
      brand(S.domain, "described", "positive"),
    ],
  },
  {
    id: "outdated-fact",
    tests: "a factual claim without a verdict",
    text: "Northwind Outfitters was founded in 2009 and operates two stores in Oregon.",
    brands: [N],
    expected: [brand(N.domain, "described", "neutral")],
  },
  {
    id: "safety-objection",
    tests: "a buyer objection about safety",
    text: "Check the weight rating before buying Northwind Outfitters' climbing harness; several reviewers say it feels less sturdy than Summit Gear's.",
    brands: [N, S],
    expected: [
      brand(N.domain, "described", "negative", {
        domain: S.domain,
        outcome: "not_preferred",
      }),
      brand(S.domain, "described", "positive", {
        domain: N.domain,
        outcome: "preferred",
      }),
    ],
  },
  {
    id: "strong-endorsement",
    tests: "an emphatic endorsement",
    text: "Northwind Outfitters is my top pick: unbeatable warranty, genuinely helpful staff and gear that lasts. Highly recommended.",
    brands: [N],
    expected: [brand(N.domain, "recommended", "positive")],
  },
  {
    id: "avoid-strong",
    tests: "an emphatic warning",
    text: "Avoid TrailCo. Its tents leak, the zippers fail within a season and refunds are refused. Steer clear.",
    brands: [T],
    expected: [brand(T.domain, "discouraged", "negative")],
  },
  {
    id: "ranked-list",
    tests: "a ranked list with no stated reason",
    text: "Top three retailers: 1. Summit Gear 2. TrailCo 3. Northwind Outfitters.",
    brands: [N, S, T],
    expected: [
      brand(N.domain, "described", "neutral"),
      brand(S.domain, "described", "neutral"),
      brand(T.domain, "described", "neutral"),
    ],
  },
  {
    id: "ranked-with-pick",
    tests: "a ranked list ending in a pick",
    text: "Of the three, Northwind Outfitters, Summit Gear and TrailCo, I'd go with Summit Gear for most people. TrailCo is fine for beginners and Northwind Outfitters is strongest for hiking boots.",
    brands: [N, S, T],
    expected: [
      brand(N.domain, "described", "positive"),
      brand(S.domain, "recommended", "positive"),
      brand(T.domain, "described", "positive"),
    ],
  },
  {
    id: "conditional-recommendation",
    tests: "a recommendation limited to one use",
    text: "Northwind Outfitters is a good choice if you mainly hike in the rain; for desert trips I'd look elsewhere.",
    brands: [N],
    expected: [brand(N.domain, "recommended", "positive")],
  },
  {
    id: "ambiguous-stem",
    tests: "a brand whose name is a common word",
    text: "The acme approach to testing is to run every check before release. Acme.com is one of several vendors offering this.",
    brands: [A],
    expected: [brand(A.domain, "described", "neutral")],
  },
  {
    id: "irony",
    tests: "a flat statement that reads as praise only on the surface",
    text: "Summit Gear's returns policy is generous on paper. In practice customers say refunds take months and agents deflect. Northwind Outfitters refunds within a week.",
    brands: [N, S],
    expected: [
      brand(N.domain, "described", "positive", {
        domain: S.domain,
        outcome: "preferred",
      }),
      brand(S.domain, "described", "negative", {
        domain: N.domain,
        outcome: "not_preferred",
      }),
    ],
  },
  {
    id: "third-party-claim",
    tests: "a claim attributed to others",
    text: "Some forum posts call Northwind Outfitters overpriced, while others praise its customer service. I could not verify either claim.",
    brands: [N],
    expected: [brand(N.domain, "described", "mixed")],
  },
  {
    id: "long-answer-late-mention",
    tests: "a brand mentioned late in a long answer",
    text: "Choosing a sleeping bag depends on temperature rating, fill type and weight. Down is lighter but loses warmth when wet, while synthetic fill dries faster. Check the lowest comfort rating, not the extreme one. Brands to compare include Summit Gear and Northwind Outfitters, whose Alpine 15 bag is rated well by owners for warmth.",
    brands: [N, S],
    expected: [
      brand(N.domain, "described", "positive"),
      brand(S.domain, "described", "neutral"),
    ],
  },
  {
    id: "question-back",
    tests: "an answer that only asks a question",
    text: "Are you looking at Northwind Outfitters or Summit Gear? Tell me your budget and the trip length and I can compare them.",
    brands: [N, S],
    expected: [
      brand(N.domain, "described", "neutral"),
      brand(S.domain, "described", "neutral"),
    ],
  },
  {
    id: "not-recommended",
    tests: "an explicit not-recommended",
    text: "TrailCo is not recommended for winter use because its sleeping bags are only rated to 40°F. Northwind Outfitters is recommended instead.",
    brands: [N, T],
    expected: [
      brand(N.domain, "recommended", "positive", {
        domain: T.domain,
        outcome: "preferred",
      }),
      brand(T.domain, "discouraged", "negative", {
        domain: N.domain,
        outcome: "not_preferred",
      }),
    ],
  },
  {
    id: "price-fact",
    tests: "a neutral price statement",
    text: "Northwind Outfitters' Basecamp 2 tent costs $249. Summit Gear's equivalent is $279.",
    brands: [N, S],
    expected: [
      brand(N.domain, "described", "neutral"),
      brand(S.domain, "described", "neutral"),
    ],
  },
  {
    id: "double-negative",
    tests: "a double negative",
    text: "You can't go wrong with Northwind Outfitters; it's hard to find a retailer with fewer complaints.",
    brands: [N],
    expected: [brand(N.domain, "recommended", "positive")],
  },
  {
    id: "best-for-segment",
    tests: "best for a narrow segment, listed beside others",
    text: "Best for budget shoppers: TrailCo. Best for premium gear: Summit Gear. Northwind Outfitters sits in the middle on price.",
    brands: [N, S, T],
    expected: [
      brand(N.domain, "described", "neutral"),
      brand(S.domain, "recommended", "positive"),
      brand(T.domain, "recommended", "positive"),
    ],
  },
  {
    id: "warning-not-brand-specific",
    tests: "a category warning that does not name the brand badly",
    text: "Be careful with online outdoor retailers in general: check return windows and read recent reviews. Northwind Outfitters is one option.",
    brands: [N],
    expected: [brand(N.domain, "described", "neutral")],
  },
  {
    id: "praise-without-ask",
    tests: "warm description with no instruction to choose",
    text: "Northwind Outfitters has a loyal following, and owners often praise how long its jackets last.",
    brands: [N],
    expected: [brand(N.domain, "described", "positive")],
  },
  {
    id: "discouraged-by-quality",
    tests: "a poor-choice judgement without the word avoid",
    text: "TrailCo's boots are a poor choice for long hikes: the soles separate and sizing is inconsistent. Northwind Outfitters' boots hold up much better.",
    brands: [N, T],
    expected: [
      brand(N.domain, "described", "positive", {
        domain: T.domain,
        outcome: "preferred",
      }),
      brand(T.domain, "discouraged", "negative", {
        domain: N.domain,
        outcome: "not_preferred",
      }),
    ],
  },
];

/**
 * The classifier is not relied on until it agrees with these readings at
 * least this often. Stance is what a buyer is told to do, so it is held to
 * the higher bar.
 */
export const PERCEPTION_GATE = { stance: 0.85, sentiment: 0.75 } as const;
