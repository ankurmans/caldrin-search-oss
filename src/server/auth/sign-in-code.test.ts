import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { emailOTP } from "better-auth/plugins/email-otp";
import { expect, it } from "vitest";
import {
  SIGN_IN_CODE_TTL_SECONDS,
  createSignInCode,
} from "@/server/auth/sign-in-code";

async function setup() {
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret-1",
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
    }),
    plugins: [
      emailOTP({
        expiresIn: SIGN_IN_CODE_TTL_SECONDS,
        async sendVerificationOTP() {},
      }),
    ],
  });
  return { auth, ctx: { context: await auth.$context } };
}

it("lets the emailed code sign a person in, once", async () => {
  const { auth, ctx } = await setup();
  const code = await createSignInCode(ctx, "Person@Example.com");
  expect(code).toMatch(/^\d{6}$/);

  const result = await auth.api.signInEmailOTP({
    body: { email: "person@example.com", otp: code },
  });
  expect(result.user.email).toBe("person@example.com");

  await expect(
    auth.api.signInEmailOTP({
      body: { email: "person@example.com", otp: code },
    }),
  ).rejects.toThrow();
});

it("kills the code after three wrong guesses", async () => {
  const { auth, ctx } = await setup();
  const code = await createSignInCode(ctx, "person@example.com");
  const wrong = code === "000000" ? "111111" : "000000";
  for (let i = 0; i < 3; i++) {
    await expect(
      auth.api.signInEmailOTP({
        body: { email: "person@example.com", otp: wrong },
      }),
    ).rejects.toThrow();
  }
  await expect(
    auth.api.signInEmailOTP({
      body: { email: "person@example.com", otp: code },
    }),
  ).rejects.toThrow();
});
