import {
  requireConnection,
  storeFor,
  storeForProject,
} from "./shopifyConnection";
import { ContentRefusal } from "../rules/contentRefusal";
import { pickStoreBlog } from "../rules/shopifyDestination";
import type { ShopifyConnection } from "../repositories/ShopifyConnectionRepository";
import type { ShopifyStorePort } from "../shopify/ShopifyStorePort";

export async function shopifyDraftDestination(
  connection: ShopifyConnection,
  store: ShopifyStorePort,
) {
  const blog = pickStoreBlog(
    await store.listBlogs(),
    connection.blogId ?? undefined,
  );
  const identity = JSON.stringify([
    connection.mode,
    connection.shopDomain,
    blog.id,
  ]);
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity)),
  );
  const stamp = `dest_${Array.from(hash.slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  return {
    shopDomain: connection.shopDomain,
    blogId: blog.id,
    blogTitle: blog.title,
    stamp,
    record: `Shopify draft destination\nStore: ${connection.shopDomain}\nBlog: ${blog.title}\nDestination reference: ${stamp}`,
  };
}

export function draftDestinationStamp(beforeState: string | null) {
  if (!beforeState?.startsWith("Shopify draft destination\n")) return null;
  return (
    /\nDestination reference: (dest_[a-f0-9]{24})$/.exec(beforeState)?.[1] ??
    null
  );
}

export async function verifyDraftDestination(
  stamp: string,
  connection: ShopifyConnection,
  store: ShopifyStorePort,
) {
  const destination = await shopifyDraftDestination(connection, store);
  if (destination.stamp !== stamp)
    throw new ContentRefusal(
      "The Shopify destination changed. Save a new revision and propose it for the new store or blog.",
    );
  return destination.blogId;
}

export async function storeForDraftDestination(
  projectId: string,
  beforeState: string | null,
) {
  const stamp = draftDestinationStamp(beforeState);
  if (!stamp) return { store: await storeForProject(projectId), blogId: null };
  const connection = await requireConnection(projectId);
  const store = await storeFor(connection);
  return {
    store,
    blogId: await verifyDraftDestination(stamp, connection, store),
  };
}
