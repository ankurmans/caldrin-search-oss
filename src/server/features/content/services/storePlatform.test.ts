import { beforeEach, describe, expect, it, vi } from "vitest";
import { findShopifyMarker } from "../rules/shopifyDetection";
import { resetDatabase } from "./contentTestDb";
import { connect, scope } from "./shopifyChangeTestSupport";
import { StorePlatformService } from "./storePlatform";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => (await import("./contentTestDb")).contentDbMock());
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { getPerformance: vi.fn() },
}));

beforeEach(() => resetDatabase());

describe("Shopify detection", () => {
  it.each([
    ["theme assets", "<script src='https://cdn.shopify.com/s/x.js'>", null],
    ["the Shopify.shop global", "<script>Shopify.shop = 'a'</script>", null],
    ["the /cdn/shop/ path", "<img src='/cdn/shop/files/a.png'>", null],
    ["an x-shopid header", "<html></html>", { "x-shopid": "1" }],
    ["an x-shopify-stage header", "<html></html>", { "x-shopify-stage": "p" }],
  ])("finds Shopify from %s", (_name, html, headers) => {
    expect(findShopifyMarker(new Headers(headers ?? {}), html)).not.toBeNull();
  });

  it("finds nothing on an ordinary page", () => {
    expect(
      findShopifyMarker(new Headers(), "<html>shop now</html>"),
    ).toBeNull();
  });
});

describe("Shopify cards for a project", () => {
  it("always show for a project with a connected store", async () => {
    await connect();
    const status = await StorePlatformService.getStatus({
      id: scope.projectId,
      domain: null,
    });
    expect(status.detection).toBe("unknown");
    expect(status.visible).toBe(true);
  });

  it("stay hidden without a store, a detection or an override", async () => {
    const project = { id: scope.projectId, domain: null };
    expect((await StorePlatformService.getStatus(project)).visible).toBe(false);
    expect(
      (await StorePlatformService.setManualShopify(project, true)).visible,
    ).toBe(true);
  });
});
