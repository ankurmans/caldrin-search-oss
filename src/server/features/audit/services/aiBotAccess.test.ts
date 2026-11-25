import { describe, expect, it } from "vitest";
import { evaluateAiBotAccess } from "./aiBotAccess";

const origin = "https://example.com";
const allowedOf = (text: string | null) =>
  new Map(
    evaluateAiBotAccess(origin, text).map((bot) => [bot.token, bot.allowed]),
  );

describe("evaluateAiBotAccess", () => {
  it("allows every bot when there is no robots.txt", () => {
    expect([...allowedOf(null).values()].every(Boolean)).toBe(true);
  });

  it("blocks only the bots a group names, and lets a named group beat the wildcard", () => {
    const access = allowedOf(
      [
        "User-agent: GPTBot",
        "Disallow: /",
        "",
        "User-agent: *",
        "Disallow: /private",
        "",
        "User-agent: OAI-SearchBot",
        "Allow: /",
      ].join("\n"),
    );
    expect(access.get("GPTBot")).toBe(false);
    expect(access.get("OAI-SearchBot")).toBe(true);
    expect(access.get("ClaudeBot")).toBe(true);
  });

  it("blocks every bot when the wildcard disallows the whole site", () => {
    const access = allowedOf("User-agent: *\nDisallow: /");
    expect([...access.values()].some(Boolean)).toBe(false);
  });
});
