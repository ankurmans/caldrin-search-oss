import { TRACKER_SCRIPT } from "@/shared/attribution/tracker";

export function handleAttributionTracker(request: Request): Response {
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method not allowed", { status: 405 });
  return new Response(request.method === "HEAD" ? null : TRACKER_SCRIPT, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
}
