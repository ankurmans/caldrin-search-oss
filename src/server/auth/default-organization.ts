import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { toHex } from "./org-slug";

type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
};

type OrganizationCreateInput = {
  name: string;
  slug: string;
  userId: string;
};

type OrganizationCreator = (
  input: OrganizationCreateInput,
) => Promise<{ id: string }>;

function getDefaultOrganizationName(user: SessionUser) {
  const name =
    user.name?.trim() || user.email.split("@")[0] || "Caldrin Search";
  return `${name}'s organization`;
}

// Keyed on the user id alone, never the editable display name: the slug is
// unique, so a second default organization for the same user fails. A user
// who hands their org to someone else and leaves would otherwise get a fresh
// org, and a fresh free-plan credit grant, on every sign-in after a rename.
function getDefaultOrganizationSlug(user: SessionUser) {
  return `org-${toHex(user.id)}`;
}

async function getUser(userId: string) {
  const sessionUser = await AuthRepository.getUser(userId);

  if (!sessionUser?.email) {
    throw new Error("Failed to resolve user for session setup");
  }

  return sessionUser;
}

async function createDefaultOrganization(
  user: SessionUser,
  createOrganization: OrganizationCreator,
) {
  try {
    const createdOrganization = await createOrganization({
      name: getDefaultOrganizationName(user),
      slug: getDefaultOrganizationSlug(user),
      userId: user.id,
    });

    return createdOrganization.id;
  } catch (error) {
    const organizationId = await AuthRepository.findFirstOrganizationIdForUser(
      user.id,
    );

    if (organizationId) {
      return organizationId;
    }

    throw error;
  }
}

type ActiveOrganization = {
  organizationId: string;
  role: string;
};

async function findExistingActiveOrganization(
  userId: string,
): Promise<ActiveOrganization | null> {
  const lastActiveOrganizationId =
    await AuthRepository.getLastActiveOrganizationId(userId);

  if (lastActiveOrganizationId) {
    const membership = await AuthRepository.getMembership(
      userId,
      lastActiveOrganizationId,
    );

    if (membership) {
      return {
        organizationId: lastActiveOrganizationId,
        role: membership.role,
      };
    }
  }

  const newestMembership =
    await AuthRepository.findNewestMembershipForUser(userId);

  if (newestMembership) {
    return {
      organizationId: newestMembership.organizationId,
      role: newestMembership.role,
    };
  }

  return null;
}

async function createActiveOrganization(
  userId: string,
  createOrganization: OrganizationCreator,
): Promise<ActiveOrganization> {
  const sessionUser = await getUser(userId);
  const organizationId = await createDefaultOrganization(
    sessionUser,
    createOrganization,
  );

  // Read the role instead of asserting "owner": a create that lost a race
  // falls back to whatever membership won, which may not be owner-created.
  const membership = await AuthRepository.getMembership(userId, organizationId);
  return { organizationId, role: membership?.role ?? "owner" };
}

// Picks the org a user should be working in: their last-active org if
// they still belong to it, else their most recently joined org (so a fresh
// invite acceptance beats the signup-minted personal organization), else a
// newly created default organization. Used by the stale-session fallback in
// resolveSessionContext.
export async function resolveActiveOrganization(
  userId: string,
  createOrganization: OrganizationCreator,
): Promise<ActiveOrganization> {
  const existing = await findExistingActiveOrganization(userId);
  if (existing) {
    return existing;
  }
  const created = await createActiveOrganization(userId, createOrganization);
  return created;
}

// Sign-in (session-create hook) variant: same resolution, except a user with
// no memberships and a pending invitation gets NO auto-minted personal
// organization — someone who signs up from an invite link should end up in
// exactly the inviter's org, not that plus an empty personal one. Returns
// null in that window (the session carries no active org until they accept).
// Abandoning the invite flow self-heals: the next app request goes through
// resolveActiveOrganization, which still creates a default organization.
export async function resolveSignInOrganization(
  userId: string,
  createOrganization: OrganizationCreator,
): Promise<ActiveOrganization | null> {
  const existing = await findExistingActiveOrganization(userId);
  if (existing) {
    return existing;
  }

  const sessionUser = await getUser(userId);
  if (await AuthRepository.hasPendingInvitationForEmail(sessionUser.email)) {
    return null;
  }

  const created = await createActiveOrganization(userId, createOrganization);
  return created;
}
