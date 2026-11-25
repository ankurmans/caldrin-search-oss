import { authenticateAttributionKey } from "@/server/features/attribution/services/attributionKeys";
import { ingestServerEvents } from "@/server/features/attribution/services/attributionApiIngest";
import { serverBatchSchema } from "@/types/schemas/attribution";
import { allowRequest } from "./attributionHttp";

const MAX_BODY_BYTES = 512 * 1024;

/**
 * Receives authoritative events from a customer's backend: a signup, an
 * activation, a payment, a won deal. The Bearer secret key is the only
 * credential and names the project. An event sent twice with the same
 * `event_id` is stored once.
 */
export async function handleAttributionEvents(
  request: Request,
): Promise<Response> {
  if (request.method !== "POST")
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  const key = request.headers
    .get("authorization")
    ?.match(/^Bearer (\S+)$/)?.[1];
  if (!key) return new Response("Unauthorized", { status: 401 });
  const owner = await authenticateAttributionKey(key, "secret");
  if (!owner) return new Response("Unauthorized", { status: 401 });
  if (!allowRequest(owner.keyId))
    return new Response("Too many requests", {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES)
    return new Response("Too large", { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const batch = serverBatchSchema.safeParse(json);
  if (!batch.success)
    return Response.json(
      {
        error: "invalid_events",
        issues: batch.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      { status: 400 },
    );
  const result = await ingestServerEvents(owner.projectId, batch.data.events);
  return Response.json(
    {
      accepted: result.accepted,
      duplicate: result.duplicate,
      rejected: result.rejected,
      rejections: result.rejections.slice(0, 20),
    },
    {
      status:
        result.accepted + result.duplicate === 0 && result.rejected > 0
          ? 422
          : 202,
    },
  );
}
