import { formatMoney } from "@/shared/attribution/money";
import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import {
  OpportunityRefusal,
  type EvidenceInput,
  type OpportunityCandidate,
  type OpportunityPriority,
} from "@/server/features/opportunities/types";
import { rangeBounds } from "@/shared/attribution/ranges";
import { getAiReferralIntelligence } from "./attributionAiReferrals";
import { getLandingPages, type LandingRow } from "./attributionLanding";
import type { ReportQuery } from "./attributionReports";

const MIN_SESSIONS = 30;
const MIN_SEARCH_CLICKS = 50;
const MIN_AI_SESSIONS = 3;
const MIN_CITED_ANSWERS = 3;

type Rule =
  | "search_traffic_no_outcome"
  | "traffic_no_outcome"
  | "ai_sends_buyers"
  | "cited_without_visits";

type AttributionFinding = {
  key: string;
  rule: Rule;
  host: string;
  path: string;
  title: string;
  /** The numbers that fired the rule, in words. */
  reason: string;
  priority: OpportunityPriority;
  evidence: EvidenceInput[];
};

const outcomesOf = (row: { credited: Record<string, number> }) =>
  Object.values(row.credited).reduce((n, v) => n + v, 0);

const round1 = (n: number) => (Math.round(n * 10) / 10).toString();

function pageFindings(row: LandingRow, observedAt: string) {
  const out: AttributionFinding[] = [];
  const base = { host: row.host, path: row.path };
  const evidence = (extra: EvidenceInput[] = []): EvidenceInput[] => [
    {
      source: "attribution",
      label: "Sessions that landed here (Observed)",
      value: String(row.sessions),
      observedAt,
    },
    {
      source: "attribution",
      label: "Outcomes credited to this page's sessions (Observed or Linked)",
      value: round1(outcomesOf(row)),
      observedAt,
    },
    ...extra,
  ];

  if (row.search && row.search.clicks >= MIN_SEARCH_CLICKS && !row.commercial) {
    out.push({
      ...base,
      key: `search_traffic_no_outcome:${row.host}${row.path}`,
      rule: "search_traffic_no_outcome",
      title: "Search sends visitors to a page that rarely leads anywhere",
      reason: `Search Console shows ${row.search.clicks} clicks (average position ${round1(row.search.position)}) and first-party events credit no lead, booking or payment to its sessions.`,
      priority: "high",
      evidence: evidence([
        {
          source: "gsc",
          label: "Search clicks (Associated)",
          value: String(row.search.clicks),
          observedAt,
        },
      ]),
    });
  } else if (row.sessions >= MIN_SESSIONS && !row.commercial) {
    out.push({
      ...base,
      key: `traffic_no_outcome:${row.host}${row.path}`,
      rule: "traffic_no_outcome",
      title: "A page with steady visits and no credited lead or sale",
      reason: `${row.sessions} sessions landed here and none is credited with a lead, booking or payment. If the page is meant to convert, its next step may be unclear; if tracking is missing, outcomes may be unmatched.`,
      priority: "medium",
      evidence: evidence(),
    });
  }
  return out;
}

/**
 * Pages worth a person's attention, each with the rule that fired and the
 * numbers behind it. They are prompts to look, not conclusions: no rule says
 * a change will move an outcome.
 */
export async function getAttributionFindings(query: ReportQuery) {
  const observedAt = new Date().toISOString();
  const [landingPages, ai] = await Promise.all([
    getLandingPages(query),
    getAiReferralIntelligence(query),
  ]);
  const findings: AttributionFinding[] = landingPages.pages.flatMap((row) =>
    pageFindings(row, observedAt),
  );

  for (const page of ai.pages) {
    const commercial = outcomesOf(page);
    if (page.sessions >= MIN_AI_SESSIONS && commercial >= 0.5) {
      const money = page.revenue
        .map((m) => formatMoney(m.minor, m.currency))
        .join(", ");
      findings.push({
        host: page.host,
        path: page.path,
        key: `ai_sends_buyers:${page.host}${page.path}`,
        rule: "ai_sends_buyers",
        title: "AI assistants send buyers to this page",
        reason: `${page.sessions} sessions came from AI assistants and ${round1(commercial)} outcomes are credited to them${money ? ` (${money})` : ""}. Keep this page accurate and easy to cite.`,
        priority: "high",
        evidence: [
          {
            source: "attribution",
            label: "AI-referred sessions (Observed)",
            value: String(page.sessions),
            observedAt,
          },
          {
            source: "attribution",
            label: "Outcomes credited to them",
            value: round1(commercial),
            observedAt,
          },
        ],
      });
    } else if (page.citedAnswers >= MIN_CITED_ANSWERS && page.sessions === 0) {
      findings.push({
        host: page.host,
        path: page.path,
        key: `cited_without_visits:${page.host}${page.path}`,
        rule: "cited_without_visits",
        title:
          "AI answers cite this page but no AI-referred visits are recorded",
        reason: `${page.citedAnswers} stored answers cite it (${page.citedEngines.join(", ")}). Either assistants send no referrer, readers do not click, or the page has no clear next step. Add a tagged link or a self-reported source question to find out.`,
        priority: "low",
        evidence: [
          {
            source: "ai_visibility",
            label: "Answers citing this page (Associated)",
            value: String(page.citedAnswers),
            observedAt,
          },
        ],
      });
    }
  }
  return { findings, observedAt };
}

/** Stores a finding as a Search Opportunity. Nothing is changed on the site. */
export async function createAttributionOpportunity(
  scope: { projectId: string; organizationId: string },
  query: ReportQuery,
  key: string,
) {
  // Invented demo pages must never become work on a real project's list.
  if (query.demo)
    throw new OpportunityRefusal(
      "Demo data cannot be saved as an opportunity. Turn demo data off to use your own pages.",
    );
  const { findings, observedAt } = await getAttributionFindings(query);
  const finding = findings.find((f) => f.key === key);
  if (!finding)
    throw new OpportunityRefusal(
      "This finding is not in the latest data any more. Reload the page and try again.",
    );
  const { from } = rangeBounds(query.range);
  const candidate: OpportunityCandidate = {
    dedupeKey: `attribution:${finding.key}`,
    query: `${finding.host}${finding.path}`,
    pageUrl: `https://${finding.host}${finding.path}`,
    action: "refresh_existing_page",
    reason: `${finding.title}. ${finding.reason}`,
    matchedCollectionHandle: null,
    dataSource: "attribution",
    intent: "commercial",
    priority: finding.priority,
    priorityReason: finding.reason,
    observedAt,
    impressions: 0,
    clicks: 0,
    ctr: 0,
    position: 0,
    windowStart: from,
    windowEnd: observedAt,
    evidence: finding.evidence,
  };
  const opportunityId = await OpportunityRepository.upsertCandidate(
    scope,
    candidate,
  );
  return { opportunityId, finding };
}
