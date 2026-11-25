import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { expect, it } from "vitest";
import { signUpBrowserPassword } from "@/server/auth/signup-browser";

const ORIGIN = "http://localhost:3000";
const EMAIL = "person@example.com";

function setup() {
  const links = { verify: "", reset: "" };
  const auth = betterAuth({
    baseURL: ORIGIN,
    secret: "test-secret-test-secret-test-secret-1",
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ token }) => {
        links.reset = token;
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ url }) => {
        links.verify = url;
      },
    },
    plugins: [signUpBrowserPassword()],
  });
  const post = (path: string, body: object) =>
    auth.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify(body),
      }),
    );
  const signUp = async (password: string) => {
    const response = await post("/sign-up/email", {
      name: "Person",
      email: EMAIL,
      password,
    });
    return response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
  };
  const openLink = (cookie: string) =>
    auth.handler(new Request(links.verify, { headers: { cookie } }));
  const signIn = async (password: string) =>
    (await post("/sign-in/email", { email: EMAIL, password })).status;
  return { links, post, signUp, openLink, signIn };
}

it("keeps the password when the link is opened in the browser that signed up", async () => {
  const { signUp, openLink, signIn } = setup();
  const cookie = await signUp("chosen-by-the-owner");

  await openLink(cookie);

  expect(await signIn("chosen-by-the-owner")).toBe(200);
});

it("drops a stranger's password when the address owner opens the link", async () => {
  const { links, post, signUp, openLink, signIn } = setup();
  await signUp("chosen-by-a-stranger");
  // The owner tries to sign up too, which creates nothing.
  const ownersCookie = await signUp("chosen-by-the-owner");

  const opened = await openLink(ownersCookie);

  expect(opened.headers.getSetCookie().join()).toContain("session_token");
  expect(await signIn("chosen-by-a-stranger")).toBe(401);

  await post("/request-password-reset", { email: EMAIL });
  await post("/reset-password", {
    token: links.reset,
    newPassword: "set-by-the-owner",
  });
  expect(await signIn("set-by-the-owner")).toBe(200);
});
