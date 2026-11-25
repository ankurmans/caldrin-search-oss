import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { expect, it } from "vitest";
import { dropUnprovenCredentials } from "@/server/auth/unproven-account";

async function setup(emailVerified: boolean) {
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret-1",
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
    }),
  });
  const context = await auth.$context;
  const { internalAdapter } = context;
  const user = await internalAdapter.createUser(
    { email: "person@example.com", name: "Person", emailVerified },
    { method: "test" },
  );
  await internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: "hash",
  });
  await internalAdapter.linkAccount({
    userId: user.id,
    providerId: "google-search-console",
    accountId: "gsc",
  });
  await internalAdapter.createSession(user.id);
  return { ctx: { context }, internalAdapter, userId: user.id };
}

it("drops the password and sessions of an account nobody confirmed, keeping its data grants", async () => {
  const { ctx, internalAdapter, userId } = await setup(false);

  await dropUnprovenCredentials(ctx, userId);

  const providers = (await internalAdapter.findAccounts(userId)).map(
    (account) => account.providerId,
  );
  expect(providers).toEqual(["google-search-console"]);
  expect(await internalAdapter.listSessions(userId)).toEqual([]);
});

it("leaves a confirmed account alone", async () => {
  const { ctx, internalAdapter, userId } = await setup(true);

  await dropUnprovenCredentials(ctx, userId);

  expect(await internalAdapter.findAccounts(userId)).toHaveLength(2);
  expect(await internalAdapter.listSessions(userId)).toHaveLength(1);
});
