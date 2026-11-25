import { expect, it } from "vitest";
import { credentialToAccess } from "./openrouter";

const credential = (overrides: Record<string, string | null>) => ({
  provider: "anthropic",
  apiKey: "key",
  accountId: null,
  modelFast: null,
  modelSmart: null,
  ...overrides,
});

it("sends each chosen provider to its own endpoint with the chosen models", () => {
  expect(credentialToAccess(credential({ provider: "groq" }))).toMatchObject({
    compatKey: "key",
    baseURL: "https://api.groq.com/openai/v1",
  });
  expect(
    credentialToAccess(
      credential({ provider: "anthropic", modelFast: "my-fast" }),
    ),
  ).toMatchObject({ anthropicKey: "key", fastModel: "my-fast" });
  expect(
    credentialToAccess(
      credential({ provider: "cloudflare", accountId: "acct1" }),
    ),
  ).toMatchObject({
    baseURL: "https://api.cloudflare.com/client/v4/accounts/acct1/ai/v1",
  });
});

it("treats an unknown provider or a Cloudflare key with no account as missing", () => {
  expect(credentialToAccess(credential({ provider: "nope" }))).toBe("missing");
  expect(credentialToAccess(credential({ provider: "cloudflare" }))).toBe(
    "missing",
  );
});
