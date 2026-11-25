import { describe, expect, it } from "vitest";
import { classifySource } from "./channels";
import { computeCredits, type Touch } from "./models";
import { classifySelfReported } from "./selfReported";

describe("classifySource", () => {
  it.each([
    [{ referrerHost: "chatgpt.com" }, "ai_referral", "ChatGPT"],
    [{ utmSource: "chatgpt.com" }, "ai_referral", "ChatGPT"],
    [{ referrerHost: "www.google.co.uk" }, "organic_search", "Google"],
    [
      { referrerHost: "google.com", clickIdKind: "gclid" },
      "paid",
      "Google Ads",
    ],
    [{ referrerHost: "example.net" }, "referral", "example.net"],
    [{}, "direct", null],
  ])("reads %j as %s", (input, channel, source) => {
    expect(classifySource(input)).toMatchObject({ channel, source });
  });

  it("calls a referrer from the project's own site a self-referral", () => {
    expect(
      classifySource({
        referrerHost: "shop.example.com",
        ownHosts: ["example.com"],
      }).channel,
    ).toBe("internal");
  });

  it("lets a project rule name a new assistant ahead of the built-in rules", () => {
    const rule = {
      id: "r1",
      matchKind: "referrer_host" as const,
      pattern: "newbot.ai",
      channel: "ai_referral" as const,
      sourceLabel: "NewBot",
    };
    expect(classifySource({ referrerHost: "newbot.ai" }, [rule])).toMatchObject(
      { channel: "ai_referral", source: "NewBot", ruleId: "r1" },
    );
  });
});

describe("classifySelfReported", () => {
  it("does not read Google as organic search", () => {
    expect(classifySelfReported("Found you on Google").channel).toBe(
      "search_unspecified",
    );
  });
});

const touch = (
  id: string,
  day: number,
  channel: Touch["channel"],
  depth = 0,
): Touch => ({
  id,
  occurredAt: new Date(Date.UTC(2026, 9, day)).toISOString(),
  channel,
  source: null,
  kind: "session",
  linkDepth: depth,
});
const OUTCOME = new Date(Date.UTC(2026, 9, 20)).toISOString();
const bpByChannel = (credits: ReturnType<typeof computeCredits>) =>
  Object.fromEntries(credits.map((c) => [c.channel, c.creditBp]));

describe("computeCredits", () => {
  const journey = [
    touch("a", 1, "ai_referral"),
    touch("b", 10, "direct"),
    touch("c", 19, "organic_search"),
  ];

  it("gives each model's credit in whole basis points that total 10000", () => {
    for (const model of ["linear", "position_based", "time_decay"] as const) {
      const credits = computeCredits(model, OUTCOME, journey, 90);
      expect(credits.reduce((sum, c) => sum + c.creditBp, 0)).toBe(10000);
    }
    expect(
      bpByChannel(computeCredits("position_based", OUTCOME, journey, 90)),
    ).toEqual({
      ai_referral: 4000,
      direct: 2000,
      organic_search: 4000,
    });
  });

  it("skips a direct visit for last non-direct", () => {
    const touches = [touch("a", 1, "organic_search"), touch("b", 19, "direct")];
    expect(
      bpByChannel(computeCredits("last_non_direct", OUTCOME, touches, 90)),
    ).toEqual({ organic_search: 10000 });
  });

  it("keeps an outcome with nothing inside the lookback unknown", () => {
    expect(
      computeCredits("first_touch", OUTCOME, [touch("a", 1, "paid")], 7),
    ).toEqual([
      expect.objectContaining({
        channel: "unknown",
        creditBp: 10000,
        evidence: "unknown",
      }),
    ]);
  });

  it("marks a joined touchpoint linked and a shared split modelled", () => {
    expect(
      computeCredits("last_touch", OUTCOME, [touch("a", 19, "paid", 1)], 90)[0]
        ?.evidence,
    ).toBe("linked");
    expect(computeCredits("linear", OUTCOME, journey, 90)[0]?.evidence).toBe(
      "modelled",
    );
  });
});
