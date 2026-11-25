import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { expect, it } from "vitest";
import type { AiAnswer } from "@/shared/ai-visibility";
import { HighlightedAnswer } from "./HighlightedAnswer";

const answerText =
  "Try Acme <script>alert(1)</script> <img src=x onerror=alert(1)> or javascript:alert(1)";

const answer: AiAnswer = {
  observation: {
    id: "o",
    runId: "r",
    promptId: "p",
    prompt: "<b>best</b> tool?",
    topic: "General",
    branded: false,
    engine: "chatgpt",
    status: "completed",
    answerStatus: "answered",
    brands: [
      {
        name: "Acme",
        domain: "acme.com",
        own: true,
        mentioned: true,
        cited: false,
        firstMention: 4,
      },
    ],
    citationCount: 1,
    collectedAt: null,
    error: null,
  },
  answerText,
  answerMarkdown: answerText,
  sources: [
    {
      url: "javascript:alert(1)",
      domain: "evil.example",
      title: "<img src=x onerror=alert(2)>",
      position: 1,
    },
  ],
  mentions: [
    {
      domain: "acme.com",
      spans: [{ start: 4, end: 8 }],
      recommended: null,
      recommendationSpans: [],
      sentiment: null,
    },
  ],
  model: null,
  runNumber: 1,
  citedTextSpans: [],
  ambiguities: [],
  requestedLocationCode: 2840,
  requestedLanguageCode: "en",
  truncated: false,
};

it("renders model text and source titles as inert text, never markup", () => {
  const $ = load(
    renderToStaticMarkup(createElement(HighlightedAnswer, { answer })),
  );

  expect($("script")).toHaveLength(0);
  expect($("[onerror]")).toHaveLength(0);
  expect($("img[src='x']")).toHaveLength(0);
  expect($("b")).toHaveLength(0);
  expect($("a[href^='javascript']")).toHaveLength(0);
  expect($.text()).toContain("<script>alert(1)</script>");
  expect($.text()).toContain("<img src=x onerror=alert(2)>");
  expect($("mark[title='Mention of Acme (you)']").text()).toBe("Acme");
});
