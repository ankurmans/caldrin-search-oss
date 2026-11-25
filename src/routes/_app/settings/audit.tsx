import { createFileRoute, notFound } from "@tanstack/react-router";
import { AuditLogPage } from "@/client/features/audit-log/AuditLogPage";
import { usesBetterAuthClient } from "@/lib/auth-mode";

export const Route = createFileRoute("/_app/settings/audit")({
  // Without memberships there are no roles, so nobody could read the log.
  beforeLoad: () => {
    if (!usesBetterAuthClient()) {
      throw notFound();
    }
  },
  component: AuditLogPage,
});
