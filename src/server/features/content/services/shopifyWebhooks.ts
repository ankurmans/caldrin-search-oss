import { ContentRepository } from "../repositories/ContentRepository";
import {
  normalizeShopDomain,
  verifyWebhookHmac,
} from "../shopify/shopifyOAuth";
import { getShopifyAppCredentials } from "./shopifyConnection";

type WebhookResult = { status: 200 | 400 | 401 | 503 };

// Shopify requires these topics from every app. This app stores no customer
// data, so the customer topics only acknowledge. Uninstall and shop erasure
// drop the stored tokens: the drafts and history stay, the store is no longer
// reachable.
export async function handleShopifyWebhook(input: {
  rawBody: string;
  hmac: string | null;
  topic: string | null;
  shopDomain: string | null;
}): Promise<WebhookResult> {
  const credentials = await getShopifyAppCredentials();
  if (!credentials) return { status: 503 };
  if (
    !(await verifyWebhookHmac(
      input.rawBody,
      input.hmac,
      credentials.clientSecret,
    ))
  )
    return { status: 401 };
  if (input.topic === "app/uninstalled" || input.topic === "shop/redact") {
    let shop: string;
    try {
      shop = normalizeShopDomain(input.shopDomain ?? "");
    } catch {
      return { status: 400 };
    }
    await ContentRepository.deleteLiveConnectionsForShop(shop);
  }
  return { status: 200 };
}
