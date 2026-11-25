import { chunk, sortBy } from "remeda";
import { getStoredBrandLookup } from "@/server/features/ai-search/services/brandLookup";
import { DomainIntersectionRepository } from "@/server/features/domain/repositories/DomainIntersectionRepository";
import {
  aiState,
  compareEvidence,
  gapFor,
  normalizeQuery,
  organicState,
  planOpportunity,
  type AiAnswerEvidence,
  type OrganicEvidence,
} from "@/server/features/domain/rules/intersectionRules";
import { getStoredKeywordSample } from "@/server/features/domain/services/domainKeywordSample";
import { getStoredSerp } from "@/server/features/keywords/services/research/serp";
import type { CustomerContext } from "@/server/lib/customer-context";
import { parseResearchTargetOrThrow } from "@/server/lib/domainUtils";
import type { ResearchScope, ResearchTarget } from "@/shared/researchScope";

/** Queries the stored SERP cache is probed for, beyond the keyword reads. */
const MAX_SERP_PROBES = 60;
const PROVIDER_QUESTIONS_PER_ENGINE = 25;
const MAX_ROWS = 200;

type Input = {
  projectId: string;
  domain: string;
  scope?: ResearchScope;
  locationCode: number;
  languageCode: string;
  /** The project's own domain, to know whether tracked answers apply. */
  projectDomain: string | null;
};

function parseOrNull(value: string | null | undefined) {
  if (!value) return null;
  try {
    return parseResearchTargetOrThrow(value);
  } catch {
    return null;
  }
}

function hostOf(value: string | null | undefined): string | null {
  return parseOrNull(value)?.hostname ?? null;
}

/**
 * Whether a cited page or domain belongs to the explored target. A page URL is
 * matched on its path under a subfolder or exact-URL scope; a bare domain
 * cannot show it is inside a path, so it does not match there.
 */
function belongsTo(
  candidate: string | null | undefined,
  target: ResearchTarget,
) {
  const parsed = parseOrNull(candidate);
  if (!parsed) return false;
  const host = parsed.hostname;
  if (target.scope === "exact_url") {
    return host === target.hostname && parsed.path === target.path;
  }
  if (target.scope === "subfolder") {
    return (
      host === target.hostname &&
      (parsed.path === target.path || parsed.path.startsWith(`${target.path}/`))
    );
  }
  return (
    host === target.hostname ||
    (target.scope === "subdomains" && host.endsWith(`.${target.hostname}`))
  );
}

type AiBucket = {
  query: string;
  prompt: { id: string; topic: string; intent: string | null } | null;
  answers: AiAnswerEvidence[];
};

function providerAnswers(
  lookup: NonNullable<Awaited<ReturnType<typeof getStoredBrandLookup>>>,
  target: ResearchTarget,
  locationCode: number,
): Map<string, AiBucket> {
  const buckets = new Map<string, AiBucket>();
  // Reserve room for tracked prompts in the comparison and its SERP probes.
  const questionsPerEngine = { chat_gpt: 0, google: 0 };
  for (const row of lookup.topQueries) {
    if (questionsPerEngine[row.platform] >= PROVIDER_QUESTIONS_PER_ENGINE)
      continue;
    questionsPerEngine[row.platform]++;
    const cited = row.citedSources.filter((s) => belongsTo(s.url, target));
    const key = normalizeQuery(row.question);
    const bucket = buckets.get(key) ?? {
      query: row.question,
      prompt: null,
      answers: [],
    };
    bucket.answers.push({
      engine: row.platform === "chat_gpt" ? "chatgpt" : "google_ai_overview",
      source: "provider_mentions",
      named: true,
      cited: cited.length > 0,
      recommended: null,
      citedUrls: cited.map((s) => s.url),
      competingUrls: row.citedSources
        .filter((s) => !belongsTo(s.url, target))
        .map((s) => s.url),
      observedAt: row.lastSeenAt,
      locationCode: row.platform === "chat_gpt" ? 2840 : locationCode,
    });
    buckets.set(key, bucket);
  }
  return buckets;
}

function trackedAnswers(
  answers: Awaited<
    ReturnType<typeof DomainIntersectionRepository.latestTrackedAnswers>
  >,
  target: ResearchTarget,
  isOwn: boolean,
): Map<string, AiBucket> {
  const buckets = new Map<string, AiBucket>();
  for (const answer of answers) {
    const match = answer.matches.find((m) =>
      isOwn ? m.own : belongsTo(m.domain, target),
    );
    const cited = answer.sources.filter((s) => belongsTo(s.url, target));
    // Matching only covers the project and its tracked competitors. For any
    // other domain, an answer that does not cite it says nothing about it.
    if (!match && cited.length === 0) continue;
    const key = normalizeQuery(answer.promptText);
    const bucket = buckets.get(key) ?? {
      query: answer.promptText,
      prompt: {
        id: answer.promptId,
        topic: answer.topic,
        intent: answer.intent,
      },
      answers: [],
    };
    bucket.answers.push({
      engine: answer.engine,
      source: "tracked_answers",
      named: match?.mentioned ?? false,
      cited: (match?.cited ?? false) || cited.length > 0,
      recommended: match?.recommended ?? null,
      citedUrls: cited.map((s) => s.url),
      competingUrls: answer.sources
        .filter((s) => !belongsTo(s.url, target))
        .map((s) => s.url),
      observedAt: answer.collectedAt,
      locationCode: answer.locationCode,
    });
    buckets.set(key, bucket);
  }
  return buckets;
}

function mergeBuckets(...maps: Array<Map<string, AiBucket>>) {
  const merged = new Map<string, AiBucket>();
  for (const map of maps) {
    for (const [key, bucket] of map) {
      const current = merged.get(key);
      if (!current) {
        merged.set(key, { ...bucket, answers: [...bucket.answers] });
      } else {
        current.answers.push(...bucket.answers);
        current.prompt ??= bucket.prompt;
      }
    }
  }
  return merged;
}

const ORGANIC_PRIORITY: Record<OrganicEvidence["source"], number> = {
  rank_tracker: 0,
  serp_read: 1,
  provider_keywords: 2,
};

function addOrganic(
  map: Map<string, OrganicEvidence>,
  key: string,
  evidence: OrganicEvidence,
) {
  const current = map.get(key);
  if (
    !current ||
    ORGANIC_PRIORITY[evidence.source] < ORGANIC_PRIORITY[current.source]
  ) {
    map.set(key, evidence);
  }
}

/**
 * Where a domain's Google organic results and the AI answers about the same
 * query meet, from data already stored. It never calls a provider: what is
 * missing is reported as missing, and a live SERP is a separate action the
 * person starts with its cost in view.
 */
async function getIntersection(input: Input, billingCustomer: CustomerContext) {
  const target = parseResearchTargetOrThrow(input.domain, input.scope);
  const isOwn = hostOf(input.projectDomain) === target.hostname;
  const market = {
    projectId: input.projectId,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  };

  const [lookup, sample, answers, ranks] = await Promise.all([
    getStoredBrandLookup(
      { ...market, query: target.hostname, competitors: [] },
      billingCustomer,
    ),
    getStoredKeywordSample(
      { ...market, domain: target.hostname, scope: target.scope },
      billingCustomer,
    ),
    DomainIntersectionRepository.latestTrackedAnswers(
      input.projectId,
      input.locationCode,
      input.languageCode,
    ),
    isOwn
      ? DomainIntersectionRepository.latestTrackedRanks(
          input.projectId,
          target.hostname,
          input.locationCode,
          input.languageCode,
        )
      : Promise.resolve([]),
  ]);

  const aiByQuery = mergeBuckets(
    lookup
      ? providerAnswers(lookup, target, input.locationCode)
      : new Map<string, AiBucket>(),
    trackedAnswers(answers, target, isOwn),
  );

  const organicByQuery = new Map<string, OrganicEvidence>();
  for (const row of sample?.keywords ?? []) {
    if (row.position === null) continue;
    addOrganic(organicByQuery, normalizeQuery(row.keyword), {
      source: "provider_keywords",
      position: row.position,
      depth: null,
      url: row.url,
      checkedAt: row.serpCheckedAt,
      locationCode: input.locationCode,
    });
  }
  for (const rank of ranks) {
    addOrganic(organicByQuery, normalizeQuery(rank.keyword), {
      source: "rank_tracker",
      position: rank.position,
      depth: rank.depth,
      url: rank.url,
      checkedAt: rank.checkedAt,
      locationCode: rank.locationCode,
    });
  }

  // A SERP read someone already paid for answers a query the other sources do
  // not cover, and is the only source that shows absence from the top results.
  const probes = [...aiByQuery.entries()]
    .filter(([key]) => !organicByQuery.has(key))
    .slice(0, MAX_SERP_PROBES);
  for (const part of chunk(probes, 10)) {
    const reads = await Promise.all(
      part.map(([, bucket]) =>
        getStoredSerp({ ...market, keyword: bucket.query }, billingCustomer),
      ),
    );
    part.forEach(([key], index) => {
      const read = reads[index];
      if (!read) return;
      const hit = read.items.find(
        (item) => belongsTo(item.url, target) || belongsTo(item.domain, target),
      );
      addOrganic(organicByQuery, key, {
        source: "serp_read",
        position: hit?.rank ?? null,
        depth: read.depth,
        url: hit?.url ?? null,
        checkedAt: read.fetchedAt,
        locationCode: input.locationCode,
      });
    });
  }

  const rows = [...aiByQuery.entries()].map(([key, bucket]) => {
    const organic = organicByQuery.get(key) ?? null;
    const compared = bucket.answers.map((answer) => ({
      answer,
      comparison: organic ? compareEvidence(organic, answer) : null,
    }));
    const comparable = compared.filter((c) => c.comparison?.comparable);
    const organicStatus = organicState(organic);
    const aiStatus = aiState(comparable.map((c) => c.answer));
    const competing = comparable.some((c) => c.answer.competingUrls.length > 0);
    const gap =
      organic && comparable.length > 0
        ? gapFor(organicStatus, aiStatus, competing)
        : null;
    const plan = planOpportunity({
      gap,
      organicUrl: organic?.url ?? null,
      position: organic?.position ?? null,
      intent: toIntent(bucket.prompt?.intent),
    });
    return {
      key,
      query: bucket.query,
      prompt: bucket.prompt,
      organic,
      organicState: organicStatus,
      answers: compared.map(({ answer, comparison }) => ({
        ...answer,
        comparison,
      })),
      aiState: aiStatus,
      comparable: comparable.length > 0,
      gap,
      opportunity: gap ? plan : null,
    };
  });

  const matched = rows.filter((row) => row.organic !== null);
  return {
    domain: target.hostname,
    isOwn,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    sources: {
      providerMentions: lookup
        ? { status: "stored" as const, fetchedAt: lookup.fetchedAt }
        : { status: "missing" as const },
      keywordSample: sample
        ? {
            status: "stored" as const,
            fetchedAt: sample.fetchedAt,
            keywords: sample.keywords.length,
          }
        : { status: "missing" as const },
      trackedAnswers: answers.length,
      trackedRanks: ranks.length,
    },
    counts: {
      aiQueries: rows.length,
      withOrganic: matched.length,
      comparable: matched.filter((row) => row.comparable).length,
      withoutOrganic: rows.length - matched.length,
      organicWithoutAi: [...organicByQuery.keys()].filter(
        (key) => !aiByQuery.has(key),
      ).length,
    },
    rows: [
      ...sortBy(matched, (row) => (row.gap === null ? 1 : 0)),
      ...rows.filter((row) => row.organic === null),
    ].slice(0, MAX_ROWS),
  };
}

function toIntent(value: string | null | undefined) {
  return value === "informational" ||
    value === "commercial" ||
    value === "transactional" ||
    value === "navigational"
    ? value
    : null;
}

export const DomainIntersectionService = { getIntersection };
