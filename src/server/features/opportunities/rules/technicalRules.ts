import type { OpportunityAction } from "@/server/features/content/rules/opportunityRules";
import {
  CRAWL_STOP_ISSUE_TYPES,
  getIssueDescriptor,
} from "@/shared/audit-issues";
import type {
  AuditIssueRow,
  EngineInputs,
  OpportunityCandidate,
} from "../types";
import { priorityFromSeverity } from "./priorityRules";

const MAX_SAMPLE_PAGES = 10;

const TITLE_META_ISSUES = new Set([
  "missing-title",
  "duplicate-title",
  "title-too-long",
  "title-too-short",
  "missing-meta-description",
  "duplicate-meta-description",
  "meta-description-too-long",
  "meta-description-too-short",
]);

// Orphan pages are handled by the internal-link rules, one opportunity per page.
const HANDLED_ELSEWHERE = new Set<string>([
  "orphan-page",
  ...CRAWL_STOP_ISSUE_TYPES,
]);

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const;

function actionFor(issueType: string): OpportunityAction {
  if (TITLE_META_ISSUES.has(issueType)) return "improve_title_and_meta";
  if (issueType === "thin-content") return "refresh_existing_page";
  return "technical_fix";
}

// One opportunity per issue type from the stored audit rows. Nothing is
// re-crawled: every number is a count of rows the audit already wrote.
export function technicalCandidates(
  audit: NonNullable<EngineInputs["audit"]>,
  observedAt: string,
): OpportunityCandidate[] {
  const groups = new Map<string, AuditIssueRow[]>();
  for (const issue of audit.issues) {
    if (HANDLED_ELSEWHERE.has(issue.issueType)) continue;
    const list = groups.get(issue.issueType) ?? [];
    list.push(issue);
    groups.set(issue.issueType, list);
  }
  const day = audit.observedAt.slice(0, 10);
  const out: OpportunityCandidate[] = [];
  for (const [issueType, rows] of groups) {
    const descriptor = getIssueDescriptor(issueType);
    const title = descriptor?.title ?? issueType;
    const severity = rows.reduce<AuditIssueRow["severity"]>(
      (worst, row) =>
        SEVERITY_RANK[row.severity] < SEVERITY_RANK[worst]
          ? row.severity
          : worst,
      "info",
    );
    const urls = [...new Set(rows.map((r) => r.pageUrl))];
    const action = actionFor(issueType);
    out.push({
      dedupeKey: `technical::${issueType}`,
      query: title,
      pageUrl: urls.length === 1 ? (urls[0] ?? null) : null,
      action,
      reason: `The latest site audit found "${title}" on ${urls.length} page${urls.length === 1 ? "" : "s"}.${descriptor ? ` ${descriptor.howToFix}` : ""}`,
      matchedCollectionHandle: null,
      dataSource: "site_audit",
      intent: null,
      ...priorityFromSeverity({ severity, pageCount: urls.length }),
      observedAt,
      impressions: 0,
      clicks: 0,
      ctr: 0,
      position: 0,
      windowStart: day,
      windowEnd: day,
      evidence: [
        {
          source: "site_audit",
          label: "Issue",
          value: `${title} (${issueType})`,
          observedAt: audit.observedAt,
        },
        {
          source: "site_audit",
          label: "Severity",
          value: severity,
          observedAt: audit.observedAt,
        },
        {
          source: "site_audit",
          label: "Affected pages",
          value: `${urls.length}`,
          observedAt: audit.observedAt,
        },
        ...urls.slice(0, MAX_SAMPLE_PAGES).map((url) => ({
          source: "site_audit",
          label: "Affected page",
          value: url,
          url,
          observedAt: audit.observedAt,
        })),
      ],
    });
  }
  return out;
}
