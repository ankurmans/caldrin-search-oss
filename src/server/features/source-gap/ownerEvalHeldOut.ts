import type { EvalSite } from "./ownerEvalSites";
import { ar, ht, pd, pr, rd } from "./ownerTestWeb";

const payhook = "https://payhook.example";
const stride = "https://stride.example";
const northline = "https://northline.example";

/** Written after the scorer was settled, and not used to tune it. */
export const HELD_OUT_SITES: EvalSite[] = [
  {
    name: "payments API",
    domain: "payhook.example",
    listed: [
      `${payhook}/docs/quickstart`,
      `${payhook}/pricing`,
      `${payhook}/compare/best-payment-apis`,
      `${payhook}/docs/webhooks`,
      `${payhook}/blog/why-we-are-open`,
    ],
    web: {
      [`${payhook}/docs/quickstart`]: {
        spec: ht("How to send your first payment with the Payhook API", [
          "Create an API key",
          "Install the library",
          "Send a payment",
        ]),
      },
      [`${payhook}/pricing`]: {
        spec: pr("Payhook pricing per transaction", ["Starter", "Scale"]),
        failTimes: 1,
      },
      [`${payhook}/compare/best-payment-apis`]: {
        spec: rd("The best payment APIs for startups", [
          "Payhook",
          "Ledgerly",
          "Coinbase-style",
          "Railpay",
        ]),
      },
      [`${payhook}/docs/webhooks`]: {
        spec: ar(
          "Webhooks for payment events",
          "Payhook sends a webhook to your server when a payment succeeds, fails or is refunded.",
          "Verify the signature on each webhook before you trust the event.",
        ),
      },
      [`${payhook}/blog/why-we-are-open`]: {
        spec: ar(
          "Why our API is open",
          "We publish our API and our changelog so you can see what changes.",
        ),
      },
    },
    cases: [
      {
        prompt: "How do I send my first payment with an API?",
        owner: `${payhook}/docs/quickstart`,
      },
      {
        prompt: "What are the best payment APIs for startups?",
        choose: true,
        owner: `${payhook}/compare/best-payment-apis`,
      },
      {
        prompt: "How much does Payhook charge per transaction?",
        owner: `${payhook}/pricing`,
      },
      {
        prompt: "How do webhooks work for payment events?",
        owner: `${payhook}/docs/webhooks`,
      },
      {
        prompt: "Which payroll software handles contractors?",
        choose: true,
        owner: null,
      },
    ],
  },
  {
    name: "shoe store",
    domain: "stride.example",
    listed: [
      `${stride}/shop/running-shoes`,
      `${stride}/best-shoes`,
      `${stride}/guides/best-running-shoes`,
      `${stride}/guides/how-to-size-running-shoes`,
      `${stride}/shipping-and-returns`,
    ],
    web: {
      [`${stride}/shop/running-shoes`]: {
        spec: pd(
          "Running shoes",
          "Stride",
          "Shop running shoes for road and trail.",
        ),
      },
      [`${stride}/best-shoes`]: { to: `${stride}/guides/best-running-shoes` },
      [`${stride}/guides/best-running-shoes`]: {
        spec: rd("The best running shoes for every runner", [
          "Cloudline",
          "Tempo",
          "Ridge",
          "Glide",
        ]),
        links: [`${stride}/guides/trail-vs-road-shoes`],
      },
      [`${stride}/guides/how-to-size-running-shoes`]: {
        spec: ht("How to choose the right size of running shoes", [
          "Measure your foot",
          "Leave a thumb of space",
          "Try them in the afternoon",
        ]),
      },
      [`${stride}/shipping-and-returns`]: {
        spec: ar(
          "Shipping and returns",
          "You can return running shoes within thirty days for a full refund.",
          "Returns are free in the United States.",
        ),
      },
      [`${stride}/guides/trail-vs-road-shoes`]: {
        spec: rd("Trail or road running shoes: which should you buy?", [
          "Trail shoes",
          "Road shoes",
          "Hybrid shoes",
        ]),
      },
    },
    cases: [
      {
        prompt: "What are the best running shoes for flat feet?",
        choose: true,
        owner: `${stride}/guides/best-running-shoes`,
      },
      {
        prompt: "How do I choose the right size of running shoes?",
        owner: `${stride}/guides/how-to-size-running-shoes`,
      },
      {
        prompt: "Should I buy trail or road running shoes?",
        choose: true,
        owner: `${stride}/guides/trail-vs-road-shoes`,
      },
      {
        prompt: "What is the return policy for running shoes?",
        owner: `${stride}/shipping-and-returns`,
      },
      {
        prompt: "Which standing desk is best for back pain?",
        choose: true,
        owner: null,
      },
    ],
  },
  {
    name: "SEO agency",
    domain: "northline.example",
    listed: [
      `${northline}/services/seo`,
      `${northline}/pricing/packages`,
      `${northline}/case-studies/fintech-growth`,
      `${northline}/blog/how-to-audit-your-site`,
      `${northline}/blog/best-seo-tools`,
      `${northline}/resources/seo-checklist`,
    ],
    web: {
      [`${northline}/services/seo`]: {
        spec: pd(
          "SEO services for growing companies",
          "Northline",
          "Northline is an SEO agency for growing companies.",
        ),
      },
      [`${northline}/pricing/packages`]: {
        spec: pr("SEO agency retainer packages and pricing", [
          "Launch",
          "Grow",
          "Lead",
        ]),
      },
      [`${northline}/case-studies/fintech-growth`]: {
        spec: ar(
          "How a fintech doubled its organic signups",
          "A fintech client came to us with flat organic traffic.",
          "Twelve months later signups from search had doubled.",
        ),
      },
      [`${northline}/blog/how-to-audit-your-site`]: {
        spec: ht("How to run an SEO audit on your website", [
          "Crawl the site",
          "Check indexing",
          "Fix the biggest issues first",
        ]),
      },
      [`${northline}/blog/best-seo-tools`]: {
        spec: rd("The best SEO tools for agencies", [
          "Crawlr",
          "Rankwise",
          "Linkscope",
          "Sitepulse",
        ]),
      },
      [`${northline}/resources/seo-checklist`]: {
        spec: ht("The SEO checklist", ["Audit", "Fix", "Publish"]),
        blocked: true,
      },
    },
    cases: [
      {
        prompt: "How much does an SEO agency cost per month?",
        owner: `${northline}/pricing/packages`,
      },
      {
        prompt: "How do I run an SEO audit on my website?",
        owner: `${northline}/blog/how-to-audit-your-site`,
      },
      {
        prompt: "What are the best SEO tools for agencies?",
        choose: true,
        owner: `${northline}/blog/best-seo-tools`,
      },
      {
        prompt: "What should be on an SEO checklist?",
        owner: `${northline}/resources/seo-checklist`,
      },
      {
        prompt: "Which accounting software suits freelancers?",
        choose: true,
        owner: null,
      },
    ],
  },
];
