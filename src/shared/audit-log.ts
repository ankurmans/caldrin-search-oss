// What the audit log records. Each action is a person, an agent or the system
// changing something that matters to the workspace: access, keys, spend,
// approvals, publishing and agent writes. Reads are never recorded.
export const AUDIT_ACTION_LABELS = {
  "workspace.key_saved": "Provider key saved",
  "workspace.key_removed": "Provider key removed",
  "workspace.mode_changed": "Workspace mode changed",
  "member.invitation_requested": "Project invitation requested",
  "member.invitation_approved": "Project invitation approved",
  "member.invitation_declined": "Project invitation declined",
  "member.invited": "Teammate invited",
  "member.project_access_changed": "Project access changed",
  "member.ownership_transferred": "Ownership transferred",
  "project.created": "Project created",
  "project.archived": "Project archived",
  "project.restored": "Project restored",
  "project.deleted": "Project deleted",
  "spend.limits_changed": "Spend limits changed",
  "report.client_access_changed": "Report client access changed",
  "branding.updated": "Shared report branding changed",
  "crawler.key_rotated": "AI crawler snippet key created or replaced",
  "crawler.cloudflare_connected":
    "Cloudflare analytics connected for AI crawler visits",
  "crawler.cloudflare_disconnected": "Cloudflare analytics disconnected",
  "attribution.settings_changed": "Revenue attribution settings changed",
  "attribution.key_rotated":
    "Revenue attribution write key created or replaced",
  "attribution.property_changed":
    "Revenue attribution website added or removed",
  "attribution.brand_changed": "Revenue attribution brand added",
  "attribution.rule_changed": "Revenue attribution source rule changed",
  "attribution.reprocessed": "Revenue attribution rebuilt from the ledger",
  "attribution.data_deleted": "Revenue attribution records deleted",
  "attribution.connector_changed":
    "Revenue attribution payment connector changed",
  "attribution.posthog_imported":
    "Revenue attribution imported PostHog page views",
  "attribution.imported": "Revenue attribution file imported",
  "attribution.demo_changed": "Revenue attribution demo data added or removed",
  ai_claim_review: "Claim Intelligence activity",
  "ledger.change_approved": "Change approved",
  "ledger.change_rejected": "Change rejected",
  "ledger.decision_recorded": "Final decision recorded",
  "content.published": "Content published",
  "integration.connected": "Integration connected",
  "integration.disconnected": "Integration disconnected",
  "integration.updated": "Integration setting changed",
  "links.outreach_approved": "Link outreach approved",
  "links.outreach_sent": "Link outreach marked sent",
  "links.reply_logged": "Link outreach reply logged",
  "links.suppression_changed": "Do-not-contact list changed",
  "agent.tool_called": "Agent changed data",
} as const;

export type AuditAction = keyof typeof AUDIT_ACTION_LABELS;

export const AUDIT_ACTOR_KINDS = ["user", "agent", "system"] as const;
export type AuditActorKind = (typeof AUDIT_ACTOR_KINDS)[number];

export const AUDIT_OUTCOMES = ["success", "refused", "failed"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

const LABELS: Record<string, string> = AUDIT_ACTION_LABELS;

/** The readable name of an action; an action from a newer version shows as is. */
export function auditActionLabel(action: string) {
  return LABELS[action] ?? action;
}
