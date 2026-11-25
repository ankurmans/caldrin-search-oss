import type { QualityCheck } from "./qualityChecks";
import { hasBlockingFailure } from "./qualityChecks";

export type PublishableAsset = {
  status: "draft" | "approved" | "published" | "failed";
  revision: number;
  approvedRevision: number | null;
};

export type PublishAction = "create_draft" | "publish" | "update";

const ACTIONS: readonly PublishAction[] = ["create_draft", "publish", "update"];

// Bound to the exact revision: editing the draft changes the key, so an old
// approval can never authorize a newer body, and a retry of the same revision
// can never create a second article. An update also carries a discriminator
// (a hash of the target and its text when proposed) so that a second attempt
// after the live article moved is a new change, not a replay of a stale one.
export function idempotencyKey(
  assetId: string,
  revision: number,
  action: PublishAction,
  discriminator?: string,
): string {
  const base = `shopify:${assetId}:r${revision}:${action}`;
  return discriminator ? `${base}:${discriminator}` : base;
}

// The action a ledger entry's key stands for, or null for a foreign key.
export function actionFromKey(key: string): PublishAction | null {
  const [prefix, , , action] = key.split(":");
  const found = ACTIONS.find((a) => a === action);
  return prefix === "shopify" && found ? found : null;
}

export type PolicyResult = { ok: true } | { ok: false; reason: string };

export function canApprove(
  asset: PublishableAsset,
  checks: QualityCheck[],
): PolicyResult {
  if (asset.status === "published") {
    return { ok: false, reason: "This revision is already published." };
  }
  if (checks.length === 0) {
    return {
      ok: false,
      reason: "Quality checks have not run for this revision.",
    };
  }
  if (hasBlockingFailure(checks)) {
    const failed = checks
      .filter((c) => c.severity === "block" && !c.passed)
      .map((c) => c.key)
      .join(", ");
    return { ok: false, reason: `Blocking quality checks failed: ${failed}.` };
  }
  return { ok: true };
}

export function canCreateShopifyDraft(
  asset: PublishableAsset,
  connection: { canPublish: boolean } | null,
): PolicyResult {
  if (!connection)
    return { ok: false, reason: "No Shopify store is connected." };
  if (
    (asset.status !== "approved" && asset.status !== "published") ||
    asset.approvedRevision !== asset.revision
  ) {
    return {
      ok: false,
      reason: "The current revision has not been approved.",
    };
  }
  if (!connection.canPublish) {
    return {
      ok: false,
      reason:
        "This connection is read-only. Reconnect with write_content to create articles.",
    };
  }
  return { ok: true };
}
