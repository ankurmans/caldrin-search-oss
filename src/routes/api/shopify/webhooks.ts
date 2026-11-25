import { createFileRoute } from "@tanstack/react-router";
import { handleShopifyWebhook } from "@/server/features/content/services/shopifyWebhooks";

// Shopify's mandatory webhooks: app/uninstalled and the privacy topics. The
// signature is checked over the raw body, so nothing here reads it as JSON.
async function handle(request: Request) {
  const result = await handleShopifyWebhook({
    rawBody: await request.text(),
    hmac: request.headers.get("x-shopify-hmac-sha256"),
    topic: request.headers.get("x-shopify-topic"),
    shopDomain: request.headers.get("x-shopify-shop-domain"),
  });
  return new Response(null, { status: result.status });
}

export const Route = createFileRoute("/api/shopify/webhooks")({
  server: {
    handlers: {
      POST: ({ request }: { request: Request }) => handle(request),
    },
  },
});
