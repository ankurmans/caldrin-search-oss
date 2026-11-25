import { AI_BOT_USER_AGENT_TOKENS } from "./ai-bots";

/**
 * A Cloudflare Worker for the customer's own zone. It passes every request
 * through untouched and, after the response is sent, reports the ones whose
 * user agent names a known AI crawler. The key is a Worker secret, never in
 * the code.
 */
export function crawlerSnippet(origin: string) {
  const bots = AI_BOT_USER_AGENT_TOKENS.join("|");
  return `const BOTS = /${bots}/i;

export default {
  async fetch(request, env, ctx) {
    const response = await fetch(request);
    const userAgent = request.headers.get("user-agent") || "";
    if (BOTS.test(userAgent)) {
      ctx.waitUntil(
        fetch("${origin}/api/crawler-events", {
          method: "POST",
          headers: {
            authorization: "Bearer " + env.CALDRIN_CRAWLER_KEY,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            userAgent,
            path: new URL(request.url).pathname,
            status: response.status,
          }),
        }).catch(() => {}),
      );
    }
    return response;
  },
};
`;
}
