import type { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";

export type EnsuredProject = NonNullable<
  Awaited<ReturnType<typeof ProjectRepository.getProjectForOrganization>>
>;

export type EnsuredUserContext = {
  userId: string;
  userEmail: string;
  // True when the user's email is verified (password mode) or auth is delegated
  // (Cloudflare Access / local), where there is no unverified state. Used to
  // gate paid onboarding spend behind verification.
  emailVerified: boolean;
  organizationId: string;
  // The caller's role in organizationId, from their member row (comma-joined
  // when multiple; check via hasOrgPermission, never string equality).
  // Delegated modes (Cloudflare Access / local) have one implicit user per
  // org and no member rows, so they resolve as "owner".
  role: string;
  // null/undefined = every project. Set for scoped members: the only project
  // ids they may open (see src/server/auth/project-access.ts).
  allowedProjectIds?: string[] | null;
  project?: EnsuredProject;
};
