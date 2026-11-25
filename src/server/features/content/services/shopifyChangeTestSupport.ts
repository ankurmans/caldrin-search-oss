import { vi } from "vitest";
import { ContentRepository } from "../repositories/ContentRepository";
import {
  SIMULATED_SEED_ARTICLE_ID,
  createSimulatedShop,
} from "../shopify/simulatedShop";
import {
  approveShopifyChange,
  proposeShopifyChange,
} from "./shopifyChangePlan";
import { connectShopify, connectSimulatedShop } from "./shopifyConnection";
import type { Scope } from "./shopifyConnection";

// Test-only fixtures for the Shopify change workflow tests.

export const scope: Scope = {
  projectId: "project-a",
  organizationId: "org-1",
  userId: "manager-1",
};

export const SEED_ONLY = 1;
export const confirmed = {
  confirmUpdate: true,
  targetExternalId: SIMULATED_SEED_ARTICLE_ID,
};

let domain = "";
let counter = 0;

const nextDomain = () => `test-${++counter}.myshopify.com`;

export async function connect() {
  // A fresh domain per test: the simulated shop keeps state per domain.
  domain = nextDomain();
  await connectSimulatedShop(scope, domain);
}

// A live connection made through the real connect path, with Shopify answered
// by a fake fetch. Returns the spy so a test can prove nothing else is called.
export async function connectLive(accessScopes: string[]) {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: {
            shop: { name: "Live Shop" },
            currentAppInstallation: {
              accessScopes: accessScopes.map((handle) => ({ handle })),
            },
          },
        }),
      ),
    ),
  );
  await connectShopify(scope, {
    shopDomain: nextDomain(),
    accessToken: "shpat_live_token_value",
  });
  fetchSpy.mockClear();
  return fetchSpy;
}

export async function makeAsset(
  over: Partial<Parameters<typeof ContentRepository.createAsset>[0]> = {},
) {
  const asset = await ContentRepository.createAsset({
    projectId: scope.projectId,
    organizationId: scope.organizationId,
    opportunityId: null,
    title: "Best light roast coffee",
    searchIntent: "x",
    briefMarkdown: "x",
    bodyHtml: "<p>Intro</p><p>Details</p>",
    metaTitle: "Best light roast",
    metaDescription: "How to pick a light roast.",
    generator: "template",
    createdByUserId: "author-1",
    references: [
      {
        refType: "product",
        handle: "ethiopia-light-roast",
        title: "Ethiopia Light Roast",
        available: true,
      },
    ],
    ...over,
  });
  await ContentRepository.replaceQualityChecks(asset.id, asset.revision, [
    { key: "structure", severity: "block", passed: true, detail: "ok" },
  ]);
  return asset;
}

export const shop = () => createSimulatedShop(domain);
export const articleCount = async () => (await shop().listArticles()).length;

export async function approvedCreate(assetId: string) {
  const { entry } = await proposeShopifyChange(scope, assetId, {
    action: "create_draft",
  });
  return approveShopifyChange(scope, entry.id);
}

export async function approvedUpdate(assetId: string) {
  const { entry } = await proposeShopifyChange(scope, assetId, {
    targetExternalId: SIMULATED_SEED_ARTICLE_ID,
  });
  return approveShopifyChange(scope, entry.id);
}
