import { recordCrawlerLog } from "@/server/features/ai-crawlers/services/aiCrawlerIngest";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Receives an access log or a Vercel log-drain batch for the project that owns
 * the Bearer key, the same key the Worker snippet uses. Answers with how many
 * visits claiming to be an AI crawler were counted.
 */
export async function handleCrawlerLog(request: Request): Promise<Response> {
  if (request.method !== "POST")
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  const key = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/)?.[1];
  if (!key) return new Response("Unauthorized", { status: 401 });
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES)
    return new Response("Too large", { status: 413 });
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES)
    return new Response("Too large", { status: 413 });
  const result = await recordCrawlerLog(key, body);
  if (!result) return new Response("Unauthorized", { status: 401 });
  return Response.json(result);
}
