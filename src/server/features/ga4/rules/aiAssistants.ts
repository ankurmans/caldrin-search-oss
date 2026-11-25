// Session sources GA4 records when a person clicks a link inside an AI
// assistant. Assistants differ in what they send (a host, a bare name), so each
// one lists the spellings seen in practice. A visit from an assistant that sends
// no referrer is recorded as direct and cannot be found here.
const ASSISTANTS = [
  {
    name: "ChatGPT",
    sources: ["chatgpt.com", "chat.openai.com", "chatgpt", "openai"],
  },
  { name: "Perplexity", sources: ["perplexity.ai", "perplexity"] },
  {
    name: "Gemini",
    sources: ["gemini.google.com", "bard.google.com", "gemini"],
  },
  { name: "Claude", sources: ["claude.ai", "claude"] },
  {
    name: "Copilot",
    sources: [
      "copilot.microsoft.com",
      "copilot.com",
      "edgeservices.bing.com",
      "copilot",
    ],
  },
  { name: "Grok", sources: ["grok.com", "x.ai"] },
  { name: "Meta AI", sources: ["meta.ai"] },
  { name: "DeepSeek", sources: ["chat.deepseek.com", "deepseek.com"] },
  { name: "Mistral", sources: ["chat.mistral.ai"] },
  { name: "You.com", sources: ["you.com"] },
  { name: "Phind", sources: ["phind.com"] },
  { name: "Poe", sources: ["poe.com"] },
] as const;

export function aiAssistantFor(source: string): string | null {
  const host = source
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  return (
    ASSISTANTS.find((assistant) =>
      assistant.sources.some((known) => known === host),
    )?.name ?? null
  );
}

const escapeRegex = (value: string) => value.replace(/[.]/g, "\\.");

// RE2 for GA4's FULL_REGEXP match on the session source.
export const AI_SOURCE_REGEX = `(?i)(www\\.)?(${ASSISTANTS.flatMap(
  (assistant) => assistant.sources.map(escapeRegex),
).join("|")})`;
