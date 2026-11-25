import { z } from "zod";
import {
  aiProjectSchema,
  getAiRunSchema,
  topCitedDomainsSchema,
} from "@/types/schemas/ai-visibility";
import { compareWindowsToolSchema } from "@/server/features/ai-visibility/services/aiMeasurementSchemas";
import { crawlerActivitySchema } from "@/types/schemas/ai-crawlers";
import { defineAiTool } from "./ai-visibility-tool-factory";

export const lookupAiPromptVolumeTool = defineAiTool({
  name: "lookup_ai_prompt_volume",
  title: "Look up AI prompt volume",
  input: aiProjectSchema,
  output: z.looseObject({
    market: z.looseObject({
      locationCode: z.number(),
      languageCode: z.string(),
    }),
    looked: z.number(),
    reported: z.number(),
  }),
  readOnly: false,
  openWorld: true,
  description:
    "Ask the data provider how often people ask an AI each tracked prompt, worded exactly as saved, in the tracker's country. One paid request for the whole prompt set. The figure appears as aiVolume on each prompt in get_ai_visibility_tracker. A prompt the provider has no figure for is saved as none reported, which is unknown, not zero: most long, specific prompts have no figure. Volumes are the provider's estimates, not measurements of our own runs.",
  execute: (s, a, b) => s.lookupPromptVolumes(a, b),
  summarize: (d) =>
    `The provider reported a volume for ${d.reported} of ${d.looked} prompts; the rest have none reported (unknown, not zero).`,
});

export const getTopCitedDomainsTool = defineAiTool({
  name: "get_top_cited_domains",
  title: "Get top cited domains",
  input: topCitedDomainsSchema,
  output: z.looseObject({
    target: z.string(),
    platform: z.string(),
    domains: z.array(
      z.looseObject({
        domain: z.string(),
        owner: z.enum(["own", "competitor", "other"]),
        mentions: z.number().nullable(),
      }),
    ),
  }),
  readOnly: false,
  openWorld: true,
  description:
    "The domains an AI engine cites most in answers about a topic, from the data provider's wider sample, not from this project's own runs. Pass a keyword for a topic, or omit it to read answers that mention the project's own domain. Each domain is marked as the project's own, a saved competitor's, or other, with a source type. ChatGPT data covers US English only; Google uses the tracker's country. A paid request. Mentions are the provider's counts and a missing figure is unknown, not zero.",
  execute: (s, a, b) => s.topCitedDomains(a, b),
  summarize: (d) =>
    `${d.domains.length} domains cited most for ${d.target} on ${d.platform}.`,
});

export const compareAiVisibilityWindowsTool = defineAiTool({
  name: "compare_ai_visibility_windows",
  title: "Compare AI visibility before and after",
  input: compareWindowsToolSchema,
  output: z.looseObject({
    comparable: z.boolean(),
    reasons: z.array(z.looseObject({ code: z.string(), message: z.string() })),
    reliability: z.string(),
    attributionNote: z.string(),
    changes: z.looseObject({}).nullable(),
  }),
  readOnly: true,
  description:
    "Compare the project's stored AI answers before and after a date, for example a change you published. Give each side as run ids or a time window. The comparison is offered only when both sides measured the same prompt set version, engines, market and brand: otherwise comparable is false, changes is null, and reasons says why. With several markets checked, pass locationCode to read one market, or the sides are not comparable. Each metric (brand mentions, owned citations, recommendations) gets a verdict: insufficient_runs under 10 runs per side, within_noise when the 95% intervals overlap, outside_noise when they do not. Neither verdict shows the change caused the difference. Reads stored answers only and uses no credits. To record the readings on a change, use the Change Ledger in the app.",
  execute: (s, a) => s.compareWindows(a),
  summarize: (d) =>
    d.comparable
      ? `Comparable (${d.reliability.replaceAll("_", " ")}). ${d.attributionNote}`
      : `Not comparable: ${d.reasons.map((r) => r.message).join(" ")}`,
});

export const getAiCrawlerActivityTool = defineAiTool({
  name: "get_ai_crawler_activity",
  title: "Get AI crawler activity",
  input: crawlerActivitySchema,
  output: z.looseObject({
    days: z.number(),
    snippetInstalled: z.boolean(),
    totalHits: z.number(),
    bots: z.array(
      z.looseObject({
        token: z.string(),
        hits: z.number(),
        errorHits: z.number(),
      }),
    ),
  }),
  readOnly: true,
  path: "crawlers",
  description:
    "Visits to the project's own site that claimed to be an AI crawler (GPTBot, ClaudeBot, PerplexityBot and others), counted by the project's Worker snippet: hits per bot, per day, top paths, and how many returned 4xx or 5xx. With no snippet installed there is no data, which is not the same as no visits. The crawler is identified by its user agent only and is not checked against the operator's IP ranges, so treat counts as claims. Uses no credits. Install the snippet from the Crawlers tab in the app.",
  execute: (s, a) => s.crawlerActivity(a),
  summarize: (d) =>
    d.snippetInstalled
      ? `${d.totalHits} visits claiming to be an AI crawler in the last ${d.days} days, from ${d.bots.length} bots.`
      : "No crawler snippet is installed, so there is no visit data.",
});

export const checkAiCrawlerAccessTool = defineAiTool({
  name: "check_ai_crawler_access",
  title: "Check AI crawler access",
  input: aiProjectSchema,
  output: z.looseObject({
    origin: z.string(),
    robotsFound: z.boolean(),
    bots: z.array(
      z.looseObject({
        token: z.string(),
        role: z.string(),
        allowed: z.boolean(),
      }),
    ),
  }),
  readOnly: true,
  openWorld: true,
  path: "crawlers",
  description:
    "Reads the project site's live robots.txt and says which known AI crawlers it lets fetch the home page. Blocking a search bot keeps the site out of that assistant's answers; blocking a training bot only opts out of model training. A missing robots.txt allows everything. Includes each bot's recent visits when the Worker snippet is installed. Uses no credits.",
  execute: (s, a) => s.crawlerAccess(a),
  summarize: (d) =>
    `${d.bots.filter((b) => !b.allowed).length} of ${d.bots.length} known AI crawlers are blocked by robots.txt at ${d.origin}.`,
});

export const classifyAiVisibilitySentimentTool = defineAiTool({
  name: "classify_ai_visibility_sentiment",
  title: "Read how AI answers treat each brand",
  input: getAiRunSchema,
  output: z.looseObject({
    runId: z.string(),
    answersRead: z.number(),
    classifierVersion: z.string(),
    readingsSaved: z.number(),
    remaining: z.number(),
    costUsd: z.number(),
  }),
  readOnly: false,
  openWorld: true,
  description:
    "Read how each stored answer of one run treats the brands it names. For every brand mentioned in an answer with text it saves a stance (recommended, described or discouraged), a separate sentiment (positive, neutral, negative or mixed), the words in the answer that show it, a confidence, the strengths, weaknesses and buyer objections the answer states, and how it ranks the brand against competitors it also names. Only brands without a reading from the current classifier version are sent to a small model, up to 40 answers per call, so a repeat call on a finished run costs nothing; remaining counts answers left for another call. Answers with no text, or that only cite a page, get no reading. Sentiment labels then appear in get_ai_visibility_intelligence and get_ai_visibility_answer with the model that wrote them. Costs a few cents of model credits. It never collects new answers.",
  execute: (s, a, b) => s.classifySentiment(a, b),
  summarize: (d) =>
    `Read ${d.answersRead} answers and saved ${d.readingsSaved} brand readings for $${d.costUsd.toFixed(4)}.${d.remaining ? ` ${d.remaining} more answers are unread: call again to continue.` : ""}`,
});
