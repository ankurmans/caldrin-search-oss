import { AppError } from "@/server/lib/errors";

/** One provider call; maps provider failures to errors a person can act on. */
export async function postJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (response.ok) return response.json();
  // A provider error body can echo the request, so it is never put in a message.
  console.warn(`[llm-search] ${provider} returned ${response.status}`);
  if (response.status === 401 || response.status === 403) {
    throw new AppError(
      "VALIDATION_ERROR",
      `${provider} rejected the API key. Check the key in Settings.`,
    );
  }
  if (response.status === 429) {
    throw new AppError(
      "RATE_LIMITED",
      `${provider} is rate limiting requests.`,
    );
  }
  if (response.status >= 500) {
    throw new AppError("UPSTREAM_UNAVAILABLE", `${provider} is unavailable.`);
  }
  throw new AppError(
    "VALIDATION_ERROR",
    `${provider} could not answer this prompt (${response.status}).`,
  );
}
