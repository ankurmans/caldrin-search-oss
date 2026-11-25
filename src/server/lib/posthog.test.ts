import { expect, it, vi } from "vitest";
import { AppError } from "@/server/lib/errors";
import { captureServerError } from "@/server/lib/posthog";
import { captureClaimEvent } from "@/server/features/ai-claims/claimAnalytics";

const { capture, captureExceptionImmediate, optedOut } = vi.hoisted(() => ({
  capture: vi.fn(),
  captureExceptionImmediate: vi.fn<(error: Error) => Promise<void>>(),
  optedOut: vi.fn(),
}));
vi.mock("@/db", () => ({ withPgClient: (run: () => unknown) => run() }));
vi.mock("@/server/auth/repositories/AuthRepository", () => ({
  AuthRepository: { isAnalyticsOptedOut: optedOut },
}));
vi.mock("cloudflare:workers", () => ({
  env: { POSTHOG_PUBLIC_KEY: "phc_test", POSTHOG_HOST: "https://ph.test" },
}));
vi.mock("posthog-node", () => ({
  PostHog: class {
    capture = capture;
    captureExceptionImmediate = captureExceptionImmediate;
    shutdown = async () => {};
  },
}));

it("reports errors without their messages, which can quote customer content", async () => {
  const error = new AppError(
    "INTERNAL_ERROR",
    "Failed query: insert into keywords\nparams: coffee at home,acme.test",
  );
  error.cause = new Error("acme.test refused the connection");

  await captureServerError(error);

  const sent = captureExceptionImmediate.mock.calls[0]?.[0];
  expect(sent?.stack).toMatch(/^AppError: INTERNAL_ERROR\n\s+at /);
  expect(sent?.stack).not.toMatch(/coffee|acme/);
  const cause = sent?.cause instanceof Error ? sent.cause : undefined;
  expect(cause?.message).toBe("message redacted");
  expect(cause?.stack).not.toContain("acme");
});

it("describes uncoded errors by the status or code they carry", async () => {
  const error = new Error("Failed query: select role from member");
  error.cause = Object.assign(new Error("terminating connection"), {
    code: "57P01",
  });

  await captureServerError(error);

  expect(captureExceptionImmediate.mock.calls[0]?.[0].message).toBe("57P01");
});

it("sends only the fixed Claim outcome and account identifiers when analytics is allowed", async () => {
  const actor = {
    userId: "account",
    organizationId: "workspace",
    projectId: "private-project",
    quote: "an unpublished answer and its source",
  };
  optedOut.mockResolvedValueOnce(false);
  await captureClaimEvent(
    actor,
    "verification_reading_recorded",
    "conflict_persists",
  );

  expect(optedOut).toHaveBeenCalledExactlyOnceWith(actor.userId);
  expect(capture).toHaveBeenCalledExactlyOnceWith({
    distinctId: "account",
    event: "claims:verification_reading_recorded",
    properties: { outcome: "conflict_persists" },
    groups: { organization: "workspace" },
  });
});

it("suppresses a Claim event when the account has opted out", async () => {
  optedOut.mockResolvedValueOnce(true);
  await captureClaimEvent(
    { userId: "account", organizationId: "workspace" },
    "evidence_inspected",
  );

  expect(optedOut).toHaveBeenCalledExactlyOnceWith("account");
  expect(capture).not.toHaveBeenCalled();
});
