import { and, count, countDistinct, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditIssues, auditPages } from "@/db/schema";

/**
 * Distinct-page counts per issue type for one audit — link-level issues
 * write one row per occurrence, and consumers phrase this as "N pages".
 * Lives beside AuditRepository (same pattern as rank-tracking's
 * snapshotQueries) to keep the main repository under the file-size limit.
 */
export async function getIssueTypePageCountsForAudit(auditId: string) {
  return db
    .select({
      issueType: auditIssues.issueType,
      severity: auditIssues.severity,
      pages: countDistinct(auditIssues.pageUrl),
    })
    .from(auditIssues)
    .where(eq(auditIssues.auditId, auditId))
    .groupBy(auditIssues.issueType, auditIssues.severity);
}

/**
 * What the crawled, indexable HTML pages carry for machines to read:
 * structured data and a complete Open Graph set (title, description, image).
 * Pages that errored, redirected or are noindex are left out, because nobody
 * is expected to mark those up.
 */
export async function getMachineReadabilityCounts(auditId: string) {
  const [row] = await db
    .select({
      pages: count(),
      withStructuredData: sql<number>`coalesce(sum(case when ${auditPages.hasStructuredData} then 1 else 0 end), 0)`,
      withOpenGraph: sql<number>`coalesce(sum(case when ${isNotNull(auditPages.ogTitle)} and ${ne(auditPages.ogTitle, "")} and ${isNotNull(auditPages.ogDescription)} and ${ne(auditPages.ogDescription, "")} and ${isNotNull(auditPages.ogImage)} and ${ne(auditPages.ogImage, "")} then 1 else 0 end), 0)`,
    })
    .from(auditPages)
    .where(
      and(
        eq(auditPages.auditId, auditId),
        eq(auditPages.statusCode, 200),
        eq(auditPages.isIndexable, true),
        eq(auditPages.fetchClass, "ok"),
      ),
    );
  return {
    pages: row?.pages ?? 0,
    withStructuredData: Number(row?.withStructuredData ?? 0),
    withOpenGraph: Number(row?.withOpenGraph ?? 0),
  };
}
