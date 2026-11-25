import { Buffer } from "node:buffer";
import { generateText } from "ai";
import {
  buildChatAgentModel,
  credentialToAccess,
} from "@/server/lib/openrouter";
import type { CredentialKind } from "@/server/features/workspace/credentials";

type KeyCheckInput = {
  kind: CredentialKind;
  provider: string;
  apiKey: string;
  accountId: string | null;
  modelFast: string | null;
  modelSmart: string | null;
};

// DataForSEO authenticates with HTTP Basic, so the credential stored for a
// workspace is base64("login:password"). Users type the two parts as DataForSEO
// shows them; this joins them, so nobody has to encode anything.
export function dataforseoBasicToken(login: string, password: string): string {
  return Buffer.from(`${login}:${password}`).toString("base64");
}

type KeyCheckResult = { ok: true } | { ok: false; message: string };

const TIMEOUT_MS = 20_000;

// A cheap real call with the key, so a typo or a key without access is caught
// when it is saved, not in the middle of a research run.
export async function checkKey(input: KeyCheckInput): Promise<KeyCheckResult> {
  try {
    if (input.kind === "dataforseo") return await checkDataforseo(input.apiKey);
    if (input.kind === "tinyfish") return await checkTinyfish(input.apiKey);
    if (isAnswerEngineKind(input.kind))
      return await checkAnswerEngine(input.kind, input.apiKey);
    return await checkLlm(input);
  } catch {
    return { ok: false, message: "The provider could not be reached." };
  }
}

async function checkDataforseo(apiKey: string): Promise<KeyCheckResult> {
  const response = await fetch(
    "https://api.dataforseo.com/v3/appendix/user_data",
    {
      headers: { Authorization: `Basic ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      message:
        "DataForSEO rejected this login or password. Use the API login and API password from your DataForSEO API access page.",
    };
  }
  if (!response.ok) {
    return { ok: false, message: `DataForSEO answered ${response.status}.` };
  }
  const body: unknown = await response.json().catch(() => null);
  const code =
    typeof body === "object" && body && "status_code" in body
      ? body.status_code
      : null;
  if (code === 20000) return { ok: true };
  return { ok: false, message: "DataForSEO did not accept this key." };
}

async function checkTinyfish(apiKey: string): Promise<KeyCheckResult> {
  const response = await fetch("https://api.fetch.tinyfish.ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify({
      urls: ["https://example.com"],
      format: "markdown",
      per_url_timeout_ms: 15_000,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) {
    return { ok: false, message: "TinyFish rejected this key." };
  }
  if (!response.ok) {
    return { ok: false, message: `TinyFish answered ${response.status}.` };
  }
  return { ok: true };
}

const ANSWER_ENGINE_LABELS = {
  anthropic: "Anthropic",
  perplexity: "Perplexity",
  openai: "OpenAI",
  gemini: "Google Gemini",
} as const;

type AnswerEngineKind = keyof typeof ANSWER_ENGINE_LABELS;

function isAnswerEngineKind(kind: CredentialKind): kind is AnswerEngineKind {
  return kind in ANSWER_ENGINE_LABELS;
}

// Each provider's model list is free to read. Perplexity has none, so it gets
// the smallest answer it will give.
function answerEngineCheck(kind: AnswerEngineKind, apiKey: string) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  switch (kind) {
    case "anthropic":
      return fetch("https://api.anthropic.com/v1/models?limit=1", {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        signal,
      });
    case "openai":
      return fetch("https://api.openai.com/v1/models", {
        headers: { authorization: `Bearer ${apiKey}` },
        signal,
      });
    case "gemini":
      return fetch(
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
        { headers: { "x-goog-api-key": apiKey }, signal },
      );
    case "perplexity":
      return fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "sonar",
          max_tokens: 16,
          messages: [{ role: "user", content: "ok" }],
        }),
        signal,
      });
  }
}

async function checkAnswerEngine(
  kind: AnswerEngineKind,
  apiKey: string,
): Promise<KeyCheckResult> {
  const label = ANSWER_ENGINE_LABELS[kind];
  const response = await answerEngineCheck(kind, apiKey);
  if (response.status === 400 && kind === "gemini") {
    return { ok: false, message: "Google Gemini rejected this key." };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, message: `${label} rejected this key.` };
  }
  if (!response.ok) {
    return { ok: false, message: `${label} answered ${response.status}.` };
  }
  return { ok: true };
}

async function checkLlm(input: KeyCheckInput): Promise<KeyCheckResult> {
  const access = credentialToAccess(input);
  if (access === "missing") {
    return { ok: false, message: "That provider needs more details." };
  }
  try {
    await generateText({
      model: buildChatAgentModel(access, undefined, "smart"),
      prompt: "Reply with the single word: ok",
      maxOutputTokens: 16,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { ok: true };
  } catch {
    return {
      ok: false,
      message:
        "The provider rejected this key or model. Check the key, the account id and the model names.",
    };
  }
}
