import { describe, expect, it } from "vitest";
import { AI_SOURCE_REGEX, aiAssistantFor } from "./aiAssistants";

describe("aiAssistantFor", () => {
  it("names the assistant behind a session source", () => {
    expect(aiAssistantFor("chatgpt.com")).toBe("ChatGPT");
    expect(aiAssistantFor("WWW.Perplexity.ai")).toBe("Perplexity");
    expect(aiAssistantFor("edgeservices.bing.com")).toBe("Copilot");
  });

  it("leaves ordinary sources alone, including look-alike hosts", () => {
    expect(aiAssistantFor("google")).toBeNull();
    expect(aiAssistantFor("tribeofyou.com")).toBeNull();
    expect(aiAssistantFor("notchatgpt.com")).toBeNull();
  });
});

describe("AI_SOURCE_REGEX", () => {
  const matches = (source: string) =>
    new RegExp(`^${AI_SOURCE_REGEX.replace("(?i)", "")}$`, "i").test(source);

  it("matches only whole assistant sources", () => {
    expect(matches("chatgpt.com")).toBe(true);
    expect(matches("www.claude.ai")).toBe(true);
    expect(matches("tribeofyou.com")).toBe(false);
  });
});
