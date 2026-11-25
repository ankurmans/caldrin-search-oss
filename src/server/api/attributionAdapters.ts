import { z } from "zod";
import { importAdapterRecords } from "@/server/features/attribution/services/attributionAdapterImport";
import { authenticateAttributionKey } from "@/server/features/attribution/services/attributionKeys";
import { allowRequest } from "./attributionHttp";

const MAX_BODY_BYTES = 512 * 1024;

const bodySchema = z.object({
  // The CRM or call tracker's own name; part of every event id it produces.
  system: z.string().trim().min(1).max(60),
  records: z.array(z.unknown()).min(1).max(200),
});

/**
 * Receives CRM records or call-tracker records from a customer's system, with
 * the same secret key as the event API. Records are mapped to ledger events
 * by the adapter contract; `?dry_run=1` reports what would be added.
 */
export async function handleAttributionAdapter(
  request: Request,
  kind: "crm" | "calls",
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
  const body = bodySchema.safeParse(json);
  if (!body.success)
    return Response.json(
      {
        error: "invalid_body",
        issues: body.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      { status: 400 },
    );
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  const result = await importAdapterRecords(owner.projectId, {
    kind,
    system: body.data.system,
    records: body.data.records,
    dryRun,
  });
  return Response.json(result, { status: dryRun ? 200 : 202 });
}
