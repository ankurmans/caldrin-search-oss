import { z } from "zod";
import type { ArticleFields } from "../shopify/ShopifyStorePort";
import type { PublishAction } from "./publishPolicy";

// What a Shopify change is: the three things this workflow may do to a store,
// how each maps to a ledger kind, and what a rollback of each looks like.

export const SHOPIFY_ACTIONS = [
  "create_draft",
  "update_existing",
  "publish_draft",
] as const;
export type ShopifyAction = (typeof SHOPIFY_ACTIONS)[number];

export const ACTION_PLAN: Record<
  ShopifyAction,
  {
    kind: "content_article_create" | "content_article_update";
    keyAction: PublishAction;
  }
> = {
  create_draft: { kind: "content_article_create", keyAction: "create_draft" },
  update_existing: { kind: "content_article_update", keyAction: "update" },
  publish_draft: { kind: "content_article_update", keyAction: "publish" },
};

export function shopifyActionFromKeyAction(
  keyAction: PublishAction,
): ShopifyAction {
  const found = SHOPIFY_ACTIONS.find(
    (a) => ACTION_PLAN[a].keyAction === keyAction,
  );
  if (!found) throw new Error(`Unknown publish action ${keyAction}`);
  return found;
}

export function proposedActionText(
  action: ShopifyAction,
  title: string,
): string {
  switch (action) {
    case "create_draft":
      return `Create an unpublished draft article "${title}" in the Shopify blog (not public).`;
    case "update_existing":
      return `Replace the text of the existing Shopify article "${title}". If it is published, the change goes live immediately.`;
    case "publish_draft":
      return `Publish the Shopify draft article "${title}" so it becomes public.`;
  }
}

// 32-bit FNV-1a. Not a security hash: it only tells two proposed texts apart
// inside an idempotency key.
export function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const fieldsSchema = z.object({
  title: z.string(),
  bodyHtml: z.string(),
  metaTitle: z.string(),
  metaDescription: z.string(),
});

// Stored as text in change_ledger_entries.rollback_payload.
export const rollbackPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("restore"),
    externalId: z.string(),
    fields: fieldsSchema,
    wasPublished: z.boolean(),
  }),
  z.object({ type: z.literal("unpublish"), externalId: z.string() }),
  z.object({
    type: z.literal("manual"),
    externalId: z.string(),
    instructions: z.string(),
    previous: fieldsSchema,
  }),
]);
export type RollbackPayload = z.infer<typeof rollbackPayloadSchema>;

export type PlannedRollback = {
  kind: "restore_previous_content" | "unpublish" | "manual";
  payload: RollbackPayload;
};

// Shopify's SEO metafields cannot be set to an empty value, so text that had
// no SEO title or description cannot be put back by this app. That rollback is
// recorded as manual instead of being offered and failing (or half working).
export function planUpdateRollback(
  previous: ArticleFields & { externalId: string; isPublished: boolean },
  next: ArticleFields,
): PlannedRollback {
  const fields = {
    title: previous.title,
    bodyHtml: previous.bodyHtml,
    metaTitle: previous.metaTitle,
    metaDescription: previous.metaDescription,
  };
  const cannotBlank =
    (previous.metaTitle === "" && next.metaTitle !== "") ||
    (previous.metaDescription === "" && next.metaDescription !== "");
  if (cannotBlank) {
    return {
      kind: "manual",
      payload: {
        type: "manual",
        externalId: previous.externalId,
        previous: fields,
        instructions:
          "The article had no SEO title or description before this change, and Shopify cannot set those fields to blank through the API. Restore the previous text in the Shopify admin: the exact previous text is recorded on this change.",
      },
    };
  }
  return {
    kind: "restore_previous_content",
    payload: {
      type: "restore",
      externalId: previous.externalId,
      fields,
      wasPublished: previous.isPublished,
    },
  };
}

export function planUnpublishRollback(externalId: string): PlannedRollback {
  return { kind: "unpublish", payload: { type: "unpublish", externalId } };
}
