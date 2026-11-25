import type { DatabaseSync } from "node:sqlite";
import { beforeEach, expect, it, vi } from "vitest";
import { createMigratedDatabase } from "@/server/security/sqlite-test-db";
import { getAllowedProjectIds } from "@/server/auth/project-access";
import { InvitationRequestService } from "./InvitationRequestService";

const state = vi.hoisted(() => ({
  database: null as DatabaseSync | null,
  invite: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", async () => {
  const { createProxyDb } = await import("@/server/security/sqlite-test-db");
  return { db: createProxyDb(() => state.database) };
});
vi.mock("@/server/features/billing/platformAccess", () => ({
  getPlatformAccess: async () => ({ canInvite: true }),
}));
vi.mock("./issueTeamInvitation", () => ({ issueTeamInvitation: state.invite }));

const member = {
  userId: "member",
  userEmail: "member@example.test",
  organizationId: "org",
  role: "project_member",
};
const admin = {
  ...member,
  userId: "admin",
  userEmail: "admin@example.test",
  role: "admin",
};

beforeEach(() => {
  state.database?.close();
  state.database = createMigratedDatabase();
  state.database.exec(`
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES
      ('member', 'Member', 'member@example.test', 1, 0, 0),
      ('admin', 'Admin', 'admin@example.test', 1, 0, 0);
    INSERT INTO organization (id, name, slug, created_at) VALUES ('org', 'Workspace', 'workspace', 0);
    INSERT INTO member (id, organization_id, user_id, role, created_at)
      VALUES ('m1', 'org', 'member', 'project_member', 0), ('m2', 'org', 'admin', 'admin', 0);
    INSERT INTO projects (id, organization_id, name, domain, archived_at)
      VALUES ('allowed', 'org', 'Allowed', 'example.test', NULL), ('hidden', 'org', 'Hidden', 'hidden.test', NULL);
    INSERT INTO project_access (organization_id, user_id, project_id) VALUES ('org', 'member', 'allowed');
  `);
  state.invite.mockResolvedValue({
    invitationId: "invite",
    inviteUrl: "https://example.test/invite",
  });
});

it("requires admin approval and issues one invitation limited to the requested project", async () => {
  expect(
    await getAllowedProjectIds(
      member.userId,
      member.organizationId,
      member.role,
    ),
  ).toEqual(["allowed"]);
  await InvitationRequestService.request(
    member,
    "allowed",
    "invitee@example.test",
  );
  await InvitationRequestService.request(
    member,
    "allowed",
    "INVITEE@example.test",
  );
  const requests = await InvitationRequestService.list(admin);
  expect(requests).toHaveLength(1);
  const id = requests[0].id;
  await expect(
    InvitationRequestService.review(member, id, true),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(state.invite).not.toHaveBeenCalled();

  const reviews = await Promise.allSettled([
    InvitationRequestService.review(admin, id, true),
    InvitationRequestService.review(admin, id, true),
  ]);
  expect(reviews.filter(({ status }) => status === "fulfilled")).toHaveLength(
    1,
  );
  expect(state.invite).toHaveBeenCalledExactlyOnceWith(
    admin,
    {
      email: "invitee@example.test",
      role: "project_member",
      projectIds: ["allowed"],
    },
    false,
  );
  expect(await InvitationRequestService.list(admin)).toEqual([]);
  expect(await InvitationRequestService.list(member)).toMatchObject([
    { status: "approved" },
  ]);
});
