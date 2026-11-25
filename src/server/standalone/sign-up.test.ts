import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertOpenSignUpEmail,
  isEmailSignUpOpen,
  isStandaloneSignUpOpen,
  provisionOpenSignUpWorkspace,
} from "@/server/standalone/sign-up";

const mocks = vi.hoisted(() => ({
  hasAnyUser: vi.fn(),
  hasPendingInvitationForEmail: vi.fn(),
  setWorkspaceMode: vi.fn(),
  workerEnv: {} as Record<string, string>,
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.workerEnv }));
vi.mock("@/server/features/workspace/credentials", () => ({
  setWorkspaceMode: mocks.setWorkspaceMode,
}));
vi.mock("@/server/auth/repositories/AuthRepository", () => ({
  AuthRepository: mocks,
}));

describe("isStandaloneSignUpOpen", () => {
  beforeEach(() => {
    mocks.hasAnyUser.mockResolvedValue(true);
    mocks.hasPendingInvitationForEmail.mockResolvedValue(false);
  });

  it("lets the first account through on a fresh installation", async () => {
    mocks.hasAnyUser.mockResolvedValue(false);

    await expect(isStandaloneSignUpOpen("stranger@example.com")).resolves.toBe(
      true,
    );
  });

  it("closes once an account exists", async () => {
    await expect(isStandaloneSignUpOpen("stranger@example.com")).resolves.toBe(
      false,
    );
  });

  it("stays open for an address with a pending invitation", async () => {
    mocks.hasPendingInvitationForEmail.mockResolvedValue(true);

    await expect(isStandaloneSignUpOpen("invitee@example.com")).resolves.toBe(
      true,
    );
    expect(mocks.hasPendingInvitationForEmail).toHaveBeenCalledWith(
      "invitee@example.com",
    );
  });
});

describe("open sign-up", () => {
  beforeEach(() => {
    delete mocks.workerEnv.OPEN_SIGNUP;
  });

  it("puts a new workspace on the free test run only while sign-up is open", async () => {
    await provisionOpenSignUpWorkspace("org_a", true);
    expect(mocks.setWorkspaceMode).not.toHaveBeenCalled();

    mocks.workerEnv.OPEN_SIGNUP = "true";
    await provisionOpenSignUpWorkspace("org_b", true);
    expect(mocks.setWorkspaceMode).toHaveBeenCalledWith("org_b", "trial");
  });

  it("refuses a throwaway-inbox address once sign-up is open", () => {
    expect(() => assertOpenSignUpEmail("a@mailinator.com", true)).not.toThrow();
    mocks.workerEnv.OPEN_SIGNUP = "true";
    expect(() => assertOpenSignUpEmail("a@mailinator.com", true)).toThrow();
  });

  it("opens email-and-password sign-up only where email can confirm the address", () => {
    mocks.workerEnv.OPEN_SIGNUP = "true";
    expect(isEmailSignUpOpen()).toBe(false);
    Object.assign(mocks.workerEnv, {
      AWS_SES_ACCESS_KEY_ID: "a",
      AWS_SES_SECRET_ACCESS_KEY: "b",
      AWS_SES_REGION: "us-east-1",
      MAGIC_LINK_FROM: "Caldrin <no-reply@caldrin.co>",
    });
    expect(isEmailSignUpOpen()).toBe(true);
    for (const key of Object.keys(mocks.workerEnv)) delete mocks.workerEnv[key];
  });
});
