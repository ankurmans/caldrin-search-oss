import { recordCrawlerHit } from "@/server/features/ai-crawlers/services/aiCrawlerIngest";
import { crawlerEventSchema } from "@/types/schemas/ai-crawlers";

const MAX_BODY_BYTES = 4096;

/**
 * Receives one AI crawler visit from a customer's Worker snippet. The snippet's
 * key is the only credential; a visit whose user agent names no known AI
 * crawler is accepted and dropped.
 */
export async function handleCrawlerEvent(request: Request): Promise<Response> {
  if (request.method !== "POST")
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  const key = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/)?.[1];
  if (!key) return new Response("Unauthorized", { status: 401 });
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES)
    return new Response("Too large", { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const event = crawlerEventSchema.safeParse(json);
  if (!event.success) return new Response("Invalid event", { status: 400 });
  const result = await recordCrawlerHit(key, event.data);
  if (!result) return new Response("Unauthorized", { status: 401 });
  return new Response(null, { status: 204 });
}
