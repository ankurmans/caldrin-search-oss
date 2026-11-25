import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ContentResult } from "@/serverFunctions/content";
import type { getContentDraft } from "@/serverFunctions/contentEditorial";

export function contentKey(projectId: string) {
  return ["content", projectId];
}

export function draftKey(projectId: string, assetId: string) {
  return ["content-draft", projectId, assetId];
}

export function previewKey(projectId: string, assetId: string) {
  return ["content-preview", projectId, assetId];
}

// Expected refusals come back as typed results; show them as a toast.
export function unwrap<T>(result: ContentResult<T>): T | null {
  if (result.ok) return result.data;
  toast.error(result.reason);
  return null;
}

// Every step changes the draft, the overview list, the change ledger, the
// opportunity list (a draft marks one briefed) and published performance.
export function invalidateContent(
  queryClient: QueryClient,
  projectId: string,
  assetId: string,
) {
  const keys = [
    contentKey(projectId),
    draftKey(projectId, assetId),
    previewKey(projectId, assetId),
    ["content-performance", projectId],
    ["ledger", projectId],
    ["opportunities", projectId],
  ];
  return Promise.all(
    keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}

type Detail = Extract<
  Awaited<ReturnType<typeof getContentDraft>>,
  { ok: true }
>["data"];
export type DraftDetail = Detail;
export type LedgerChange = Detail["changes"][number];

export type ShopifyActionName =
  | "create_draft"
  | "update_existing"
  | "publish_draft";

// The idempotency key is `shopify:<asset>:r<revision>:<action>[:...]`.
export function actionOfChange(change: LedgerChange): ShopifyActionName | null {
  const [prefix, , , action] = (change.idempotencyKey ?? "").split(":");
  if (prefix !== "shopify") return null;
  if (action === "create_draft") return "create_draft";
  if (action === "update") return "update_existing";
  if (action === "publish") return "publish_draft";
  return null;
}

const FINISHED = ["rejected", "rolled_back", "abandoned"];

// Changes arrive newest first. `active` skips finished attempts, which a new
// proposal replaces.
export function findChange(
  changes: LedgerChange[],
  action: ShopifyActionName,
  revision: number,
  active = true,
): LedgerChange | null {
  return (
    changes.find(
      (c) =>
        c.contentRevision === revision &&
        actionOfChange(c) === action &&
        (!active || !FINISHED.includes(c.status)),
    ) ?? null
  );
}

export function formatTime(value: string | null): string {
  return value ? `${value.slice(0, 16).replace("T", " ")} UTC` : "";
}
