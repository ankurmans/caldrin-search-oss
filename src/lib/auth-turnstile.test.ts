import { expect, it } from "vitest";
import { getOpenSignUpTurnstileSecretKey } from "@/lib/auth-turnstile";

it("guards open sign-up only while it is open", () => {
  const env = { AUTH_MODE: "password", TURNSTILE_SECRET_KEY: "s" };
  expect(getOpenSignUpTurnstileSecretKey(env)).toBeUndefined();
  expect(getOpenSignUpTurnstileSecretKey({ ...env, OPEN_SIGNUP: "true" })).toBe(
    "s",
  );
});
