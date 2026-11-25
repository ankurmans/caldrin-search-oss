import { authenticateAttributionKey } from "@/server/features/attribution/services/attributionKeys";
import { ingestBrowserEvents } from "@/server/features/attribution/services/attributionApiIngest";
import { browserBatchSchema } from "@/types/schemas/attribution";
import {
  allowRequest,
  CORS_HEADERS,
  declaresTooLarge,
} from "./attributionHttp";

const MAX_BODY_BYTES = 32 * 1024;

/**
 * Receives page views and sessions from the tracker snippet. The key in the
 * body is public by design, so that is all it can record, and only for a host
 * the project registered. Signups, leads, bookings, payments and user ids need
 * the secret key on /api/attribution/events.
 */
export async function handleAttributionCollect(
  request: Request,
): Promise<Response> {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST")
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...CORS_HEADERS, Allow: "POST, OPTIONS" },
    });
  if (declaresTooLarge(request, MAX_BODY_BYTES))
    return new Response("Too large", { status: 413, headers: CORS_HEADERS });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES)
    return new Response("Too large", { status: 413, headers: CORS_HEADERS });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: CORS_HEADERS });
  }
  const batch = browserBatchSchema.safeParse(json);
  if (!batch.success)
    return new Response("Invalid events", {
      status: 400,
      headers: CORS_HEADERS,
    });
  const owner = await authenticateAttributionKey(batch.data.k, "public");
  if (!owner)
    return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  if (!allowRequest(owner.keyId))
    return new Response("Too many requests", {
      status: 429,
      headers: { ...CORS_HEADERS, "Retry-After": "60" },
    });
  const result = await ingestBrowserEvents(owner.projectId, {
    events: batch.data.events,
    userAgent: request.headers.get("user-agent"),
    doNotTrack:
      request.headers.get("sec-gpc") === "1" ||
      request.headers.get("dnt") === "1",
  });
  return new Response(
    JSON.stringify({ accepted: result.accepted, rejected: result.rejected }),
    {
      status: 202,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    },
  );
}
