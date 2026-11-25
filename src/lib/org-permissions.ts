import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

// App-level resources layered on top of better-auth's built-in org statements
// (organization/member/invitation management, which the plugin's own endpoints
// already enforce). Spreading defaultStatements is required — a custom
// statement object otherwise REPLACES the built-in catalog and every plugin
// permission check fails.
const statement = {
  ...defaultStatements,
  // Subscribe, top-ups, Stripe portal, cancel. Owner-only.
  billing: ["manage"],
  // Create + archive/restore projects. Renames/settings stay open to all.
  project: ["create", "delete"],
  // Project-level settings, connectors, drafts and approved changes.
  integration: ["manage"],
  workspace: ["manage"],
} as const;

export const orgAccessControl = createAccessControl(statement);

export const orgRoles = {
  owner: orgAccessControl.newRole({
    ...ownerAc.statements,
    billing: ["manage"],
    project: ["create", "delete"],
    integration: ["manage"],
    workspace: ["manage"],
  }),
  admin: orgAccessControl.newRole({
    ...adminAc.statements,
    project: ["create", "delete"],
    integration: ["manage"],
    workspace: ["manage"],
  }),
  member: orgAccessControl.newRole({
    ...memberAc.statements,
    integration: ["manage"],
  }),
  project_member: orgAccessControl.newRole({
    ...memberAc.statements,
    integration: ["manage"],
  }),
  scoped: orgAccessControl.newRole(memberAc.statements),
};

export const INVITABLE_ROLES = [
  "admin",
  "member",
  "project_member",
  "scoped",
] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isClientGuest(role: string) {
  return role.split(",").some((name) => name.trim() === "scoped");
}

export function roleUsesProjectAccess(role: string) {
  return role === "scoped" || role === "project_member";
}

// Roles that see every project. A role string with none of these is limited to
// its project_access rows, so an unknown role fails closed to no projects.
export function roleSeesAllProjects(role: string): boolean {
  return role
    .split(",")
    .some((name) => ["owner", "admin", "member"].includes(name.trim()));
}

export type OrgPermissionRequest = Partial<{
  [K in keyof typeof statement]: Array<(typeof statement)[K][number]>;
}>;

const roleByName = new Map<string, (typeof orgRoles)[keyof typeof orgRoles]>(
  Object.entries(orgRoles),
);

// better-auth stores multiple roles as one comma-separated string and ORs
// permission checks across them; mirror that here. Unknown role names fail
// closed.
export function hasOrgPermission(
  role: string,
  permissions: OrgPermissionRequest,
): boolean {
  return role.split(",").some((name) => {
    const candidate = roleByName.get(name.trim());
    return candidate ? candidate.authorize(permissions).success : false;
  });
}

export function canAccessProject(
  allowedProjectIds: string[] | null | undefined,
  projectId: string,
) {
  return !allowedProjectIds || allowedProjectIds.includes(projectId);
}
