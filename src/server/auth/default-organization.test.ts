import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSignInOrganization } from "@/server/auth/default-organization";

const mocks = vi.hoisted(() => ({
  getLastActiveOrganizationId: vi.fn(),
  getMembership: vi.fn(),
  findNewestMembershipForUser: vi.fn(),
  findFirstOrganizationIdForUser: vi.fn(),
  getUser: vi.fn(),
  hasPendingInvitationForEmail: vi.fn(),
}));

vi.mock("@/server/auth/repositories/AuthRepository", () => ({
  AuthRepository: mocks,
}));

describe("resolveSignInOrganization", () => {
  beforeEach(() => {
    mocks.getLastActiveOrganizationId.mockResolvedValue(null);
    mocks.findNewestMembershipForUser.mockResolvedValue(null);
    mocks.getUser.mockResolvedValue({
      id: "user-1",
      email: "invitee@example.com",
      name: "Invitee",
    });
    mocks.getMembership.mockResolvedValue({ role: "owner" });
  });

  // The invite-signup invariant: a brand-new user with a pending invitation
  // must NOT get a personal organization auto-minted at sign-in — accepting the
  // invite should leave them in exactly the inviter's org.
  it("defers organization creation while an invitation is pending", async () => {
    const createOrganization = vi.fn().mockResolvedValue({ id: "org-new" });

    mocks.hasPendingInvitationForEmail.mockResolvedValue(true);
    await expect(
      resolveSignInOrganization("user-1", createOrganization),
    ).resolves.toBeNull();
    expect(createOrganization).not.toHaveBeenCalled();

    mocks.hasPendingInvitationForEmail.mockResolvedValue(false);
    await expect(
      resolveSignInOrganization("user-1", createOrganization),
    ).resolves.toMatchObject({ organizationId: "org-new" });
  });

  // Trial invariant: each default org gets a fresh free test run, and the unique slug is what stops a second one. A user
  // who left their org and renamed themselves must still collide.
  it("keys the default organization slug on the user, not their name", async () => {
    mocks.hasPendingInvitationForEmail.mockResolvedValue(false);
    const createOrganization = vi.fn(async (_input: { slug: string }) => ({
      id: "org-new",
    }));

    await resolveSignInOrganization("user-1", createOrganization);
    mocks.getUser.mockResolvedValue({
      id: "user-1",
      email: "invitee@example.com",
      name: "Renamed",
    });
    await resolveSignInOrganization("user-1", createOrganization);

    const [first, second] = createOrganization.mock.calls.map(
      ([input]) => input.slug,
    );
    expect(second).toBe(first);
  });

  // An existing membership always wins — the pending-invite check only
  // applies to membership-less users, so inviting an existing user never
  // hides their current organization.
  it("returns the existing membership without checking invitations", async () => {
    mocks.findNewestMembershipForUser.mockResolvedValue({
      organizationId: "org-existing",
      role: "admin",
    });

    await expect(resolveSignInOrganization("user-1", vi.fn())).resolves.toEqual(
      { organizationId: "org-existing", role: "admin" },
    );

    expect(mocks.hasPendingInvitationForEmail).not.toHaveBeenCalled();
  });
});
