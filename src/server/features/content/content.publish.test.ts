import { describe, expect, it } from "vitest";
import {
  canApprove,
  canCreateShopifyDraft,
  idempotencyKey,
} from "./rules/publishPolicy";
import { createSimulatedShop } from "./shopify/simulatedShop";

const okChecks = [
  { key: "a", severity: "block" as const, passed: true, detail: "" },
];

describe("publish policy", () => {
  it("refuses approval while a blocking check fails", () => {
    const result = canApprove(
      { status: "draft", revision: 1, approvedRevision: null },
      [
        {
          key: "no_unsourced_claims",
          severity: "block",
          passed: false,
          detail: "",
        },
      ],
    );
    expect(result.ok).toBe(false);
  });

  it("an approval of revision 1 does not authorize revision 2", () => {
    const asset = {
      status: "approved" as const,
      revision: 2,
      approvedRevision: 1,
    };
    expect(canCreateShopifyDraft(asset, { canPublish: true }).ok).toBe(false);
    expect(canApprove(asset, okChecks).ok).toBe(true);
  });

  it("a read-only connection cannot create articles", () => {
    const asset = {
      status: "approved" as const,
      revision: 1,
      approvedRevision: 1,
    };
    const result = canCreateShopifyDraft(asset, { canPublish: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("read-only");
  });

  it("derives a key that changes with revision and action", () => {
    expect(idempotencyKey("a1", 1, "create_draft")).not.toBe(
      idempotencyKey("a1", 2, "create_draft"),
    );
    expect(idempotencyKey("a1", 1, "create_draft")).not.toBe(
      idempotencyKey("a1", 1, "publish"),
    );
  });
});

describe("simulated shop", () => {
  it("returns the same article for a retried idempotency key", async () => {
    const shop = createSimulatedShop();
    const input = {
      authorName: "Demo",
      title: "Best Light Roast",
      bodyHtml: "<p>x</p>",
      metaTitle: "t",
      metaDescription: "d",
    };
    const first = await shop.createDraftArticle(input, "k1");
    const second = await shop.createDraftArticle(input, "k1");
    expect(second).toEqual(first);
  });
});
