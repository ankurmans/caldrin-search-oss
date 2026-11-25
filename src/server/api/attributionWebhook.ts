import {
  handlePolarDelivery,
  handleStripeDelivery,
} from "@/server/features/attribution/services/attributionConnectors";
import { declaresTooLarge } from "./attributionHttp";

const MAX_BODY_BYTES = 1_000_000;

/** `?product=id1,id2` limits a Polar endpoint to those products. */
function polarProducts(request: Request) {
  return (new URL(request.url).searchParams.get("product") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => /^[A-Za-z0-9-]{8,64}$/.test(p))
    .slice(0, 20);
}

/** `POST /api/attribution/webhooks/{stripe|polar}/:connectorId` */
export async function handleAttributionWebhook(
  request: Request,
  kind: "stripe" | "polar",
  connectorId: string,
): Promise<Response> {
  if (request.method !== "POST")
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  if (declaresTooLarge(request, MAX_BODY_BYTES))
    return new Response("Too large", { status: 413 });
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES)
    return new Response("Too large", { status: 413 });
  const result =
    kind === "stripe"
      ? await handleStripeDelivery(
          connectorId,
          body,
          request.headers.get("stripe-signature"),
        )
      : await handlePolarDelivery(
          connectorId,
          body,
          {
            id: request.headers.get("webhook-id"),
            timestamp: request.headers.get("webhook-timestamp"),
            signature: request.headers.get("webhook-signature"),
          },
          polarProducts(request),
        );
  return Response.json(result.body, { status: result.status });
}
