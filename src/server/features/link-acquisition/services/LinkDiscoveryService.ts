import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import { OpportunityRefusal } from "@/server/features/opportunities/types";
import { normaliseDomain } from "@/server/features/site-explorer/rules/gapMerge";
import {
  fetchSourcePage,
  type FetchDeps,
  type FetchedPage,
} from "@/server/features/source-gap/sourcePageFetcher";
import { ProviderHealthService } from "@/server/features/provider-health/services/ProviderHealthService";
import { SpendService } from "@/server/features/spend/services/SpendService";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { backlinksReadUsd } from "@/shared/backlinks-cost";
import type { LinkActor, LinkSignalKind } from "@/shared/link-acquisition";
import { safeHttpUrl } from "@/shared/safe-url";
import { LinkProspectRepository } from "../repositories/LinkProspectRepository";
import type { NewProspect } from "../repositories/LinkProspectRepository";
import {
  classifyBrokenLink,
  classifyLostLink,
  findMention,
  mentionTerms,
  type PageState,
  type RecoveryVerdict,
} from "../rules/discovery";
import { dedupeKeyFor } from "../rules/prospectRules";
import {
  accessRefusal,
  resolveTargets,
  usd,
  type LinkAcquisitionContext,
} from "./linkAcquisitionShared";

const PROVIDER = "dataforseo";
// The provider reads this many rows and each is checked by fetching a page, so
// the read stays small and the checks stay bounded.
const RECOVERY_ROWS = 25;
const CHECK_CONCURRENCY = 5;
const MENTION_URL_LIMIT = 20;
const SOFT_SPAM = 40;

type RecoveryKind = "lost" | "broken";

const OPERATION: Record<RecoveryKind, string> = {
  lost: "link_recovery_lost",
  broken: "link_recovery_broken",
};

const actorOf = (ctx: LinkAcquisitionContext): LinkActor => ctx.actor ?? "user";

function pageState(page: FetchedPage): PageState {
  if (page.status === "ok") return "live";
  if (page.status === "not_found") return "gone";
  return "unverified";
}

function readInput(kind: RecoveryKind, own: string) {
  return {
    target: own,
    includeSubdomains: true,
    status: kind === "lost" ? ("lost" as const) : ("live" as const),
    mode: "one_per_domain",
    limit: RECOVERY_ROWS,
    hideSpam: false,
    orderBy: ["rank,desc"],
    ...(kind === "broken" ? { filters: ["is_broken", "=", true] } : {}),
  };
}

async function estimateRecovery(
  ctx: LinkAcquisitionContext,
  kind: RecoveryKind,
) {
  const { own } = await resolveTargets(ctx, []);
  const estimatedUsd = backlinksReadUsd(RECOVERY_ROWS);
  const base = {
    available: false,
    reason: null as string | null,
    own,
    estimatedUsd,
    basis: `1 DataForSEO backlinks read of up to ${RECOVERY_ROWS} ${kind === "lost" ? "lost" : "broken"} links. Each result is then checked by fetching the page, which is free.`,
    ranToday: null as { at: string; costUsd: number } | null,
  };
  if (!own) {
    return {
      ...base,
      reason: "This project has no domain set. Set the project's domain first.",
    };
  }
  const noAccess = await accessRefusal(ctx.organizationId);
  if (noAccess) return { ...base, reason: noAccess };
  const remaining = await SpendService.getRemainingUsd(ctx.projectId);
  if (remaining && estimatedUsd > remaining.usd) {
    return {
      ...base,
      reason: `The estimated cost of ${usd(estimatedUsd)} would pass this project's ${remaining.period} spend limit.`,
    };
  }
  const earlier = await SpendService.latestToday(
    ctx.projectId,
    OPERATION[kind],
  );
  return {
    ...base,
    available: true,
    ranToday: earlier
      ? { at: earlier.createdAt, costUsd: earlier.costUsd }
      : null,
  };
}

type Found = {
  domain: string;
  urlFrom: string;
  urlTo: string;
  anchor: string | null;
  rank: number | null;
  spam: number | null;
  lastSeen: string | null;
};

type Checked = { found: Found; verdict: RecoveryVerdict; targetNote: string };

async function inChunks<T, R>(items: T[], work: (item: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += CHECK_CONCURRENCY) {
    out.push(
      ...(await Promise.all(items.slice(i, i + CHECK_CONCURRENCY).map(work))),
    );
  }
  return out;
}

async function checkOne(
  kind: RecoveryKind,
  found: Found,
  own: string,
  deps: FetchDeps,
): Promise<Checked> {
  const target = await fetchSourcePage(found.urlTo, {
    ...deps,
    allowHomepage: true,
  });
  const targetState = pageState(target);
  const targetNote = `Your page ${found.urlTo}: ${targetState === "live" ? `HTTP ${target.httpStatus ?? 200}` : (target.note ?? "could not be fetched")}`;
  if (kind === "broken") {
    return {
      found,
      verdict: classifyBrokenLink({ target: targetState }),
      targetNote,
    };
  }
  const linking = await fetchSourcePage(found.urlFrom, {
    ...deps,
    allowHomepage: true,
  });
  return {
    found,
    verdict: classifyLostLink({
      linkingPage: pageState(linking),
      html: linking.html,
      finalUrl: linking.finalUrl,
      own,
      target: targetState,
    }),
    targetNote,
  };
}

function toProspect(
  kind: RecoveryKind,
  checked: Checked,
  observedAt: string,
): NewProspect | null {
  const { found, verdict } = checked;
  const key = dedupeKeyFor(found.domain);
  if (!key) return null;
  const spammy = found.spam !== null && found.spam >= SOFT_SPAM;
  const signals: NewProspect["signals"] = [
    {
      kind: (kind === "lost"
        ? "lost_link"
        : "link_page_status") as LinkSignalKind,
      value:
        kind === "lost"
          ? found.lastSeen
            ? `The provider last saw this link on ${found.lastSeen} and reports it lost.`
            : "The provider reports this link as lost."
          : "The provider reports this link as broken.",
      url: found.urlFrom,
      source: "dataforseo_backlinks",
      observedAt,
    },
    {
      kind: "link_page_status",
      value: checked.targetNote,
      url: found.urlTo,
      source: "fetched_page",
      observedAt,
    },
  ];
  return {
    dedupeKey: key,
    referringDomain: key,
    pageUrl: found.urlFrom,
    method: kind === "lost" ? "lost_link" : "broken_link",
    campaignMode: "earned_editorial",
    status: "discovered",
    recommendation:
      verdict.outcome === "recover" && !spammy ? "pursue" : "review",
    score:
      found.rank === null ? null : Math.min(100, Math.round(found.rank / 10)),
    targetUrl:
      kind === "lost" && /HTTP 2/.test(checked.targetNote) ? found.urlTo : null,
    sourceRunId: null,
    notes: [verdict.action, verdict.limitation].filter(Boolean).join(" "),
    signals,
  };
}

async function runRecovery(
  ctx: LinkAcquisitionContext,
  kind: RecoveryKind,
  options: { repeat?: boolean } = {},
  deps: FetchDeps = {},
) {
  const quote = await estimateRecovery(ctx, kind);
  if (!quote.available || !quote.own) {
    throw new OpportunityRefusal(
      `${quote.reason ?? "Not available."} Nothing was fetched.`,
    );
  }
  if (quote.ranToday && !options.repeat) {
    throw new OpportunityRefusal(
      `This already ran today for ${usd(quote.ranToday.costUsd)}. Running again is charged again, so confirm the repeat. Nothing was fetched.`,
    );
  }
  const scope = {
    projectId: ctx.projectId,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
  };
  await SpendService.assertWithinLimits(scope, {
    estimatedUsd: quote.estimatedUsd,
    provider: PROVIDER,
    operation: OPERATION[kind],
  });
  const client = createDataforseoClient(ctx);
  const own = quote.own;
  let items;
  try {
    items = (await client.backlinks.rows(readInput(kind, own))).items;
  } catch (error) {
    console.error("link-recovery.read failed:", error);
    await ProviderHealthService.recordFailure(OPERATION[kind], error, scope);
    throw new OpportunityRefusal(
      "The provider read failed, so nothing was saved. Nothing was charged.",
    );
  }
  await SpendService.recordCost(scope, {
    provider: PROVIDER,
    operation: OPERATION[kind],
    estimatedUsd: quote.estimatedUsd,
    costUsd: quote.estimatedUsd,
  });

  const found: Found[] = [];
  for (const item of items) {
    const domain = item.domain_from ? normaliseDomain(item.domain_from) : null;
    if (!domain || !item.url_from || !item.url_to) continue;
    if (found.some((entry) => entry.domain === domain)) continue;
    found.push({
      domain,
      urlFrom: item.url_from,
      urlTo: item.url_to,
      anchor: item.anchor ?? null,
      rank: item.domain_from_rank ?? null,
      spam: item.backlink_spam_score ?? item.backlinks_spam_score ?? null,
      lastSeen: item.last_seen?.slice(0, 10) ?? null,
    });
  }
  const checked = await inChunks(found, (entry) =>
    checkOne(kind, entry, own, deps),
  );
  const observedAt = new Date().toISOString();
  const prospects = checked
    .filter((entry) => ["recover", "review"].includes(entry.verdict.outcome))
    .map((entry) => toProspect(kind, entry, observedAt))
    .filter((entry): entry is NewProspect => entry !== null);
  const count = (outcome: RecoveryVerdict["outcome"]) =>
    checked.filter((entry) => entry.verdict.outcome === outcome).length;
  const saved = prospects.length
    ? await LinkProspectRepository.insertNew(
        ctx.projectId,
        prospects,
        actorOf(ctx),
        ctx.userId,
      )
    : { created: [], skipped: [] };
  return {
    read: found.length,
    created: saved.created.length,
    alreadySaved: saved.skipped.length,
    needsReview: count("review"),
    alreadyFixed: count("already_fixed"),
    stillLinking: count("still_linking"),
    pageGone: count("page_gone"),
    costUsd: quote.estimatedUsd,
  };
}

/**
 * Pages the user names are fetched, and only a page that names the brand in
 * its text and has no link to the project's site becomes a prospect. The
 * evidence saved is the fetched sentence and the address, never an inference.
 */
async function checkMentions(
  ctx: LinkAcquisitionContext,
  input: { urls: string[]; extraTerms?: string[] },
  deps: FetchDeps = {},
) {
  const [{ own }, brand] = await Promise.all([
    resolveTargets(ctx, []),
    OpportunityRepository.getProjectBrand(ctx.projectId),
  ]);
  if (!own) {
    throw new OpportunityRefusal(
      "This project has no domain set. Set the project's domain first.",
    );
  }
  const terms = [
    ...new Set([
      ...mentionTerms(brand?.brandName ?? brand?.name ?? null, own),
      ...(input.extraTerms ?? []).map((term) => term.trim().toLowerCase()),
    ]),
  ].filter((term) => term.length >= 3);
  const urls = [
    ...new Set(
      input.urls
        .map((raw) => safeHttpUrl(raw))
        .filter((url): url is string => !!url),
    ),
  ].slice(0, MENTION_URL_LIMIT);
  if (urls.length === 0) {
    throw new OpportunityRefusal("Add at least one web page address.");
  }
  const observedAt = new Date().toISOString();
  const results = await inChunks(urls, async (url) => {
    const page = await fetchSourcePage(url, { ...deps, allowHomepage: true });
    if (page.status !== "ok" || page.html === null) {
      return {
        url,
        outcome: "unreadable" as const,
        note: page.note ?? "The page could not be fetched.",
      };
    }
    const mention = findMention({
      html: page.html,
      finalUrl: page.finalUrl,
      terms,
      own,
    });
    return { url: page.finalUrl, outcome: mention.kind, mention };
  });
  const prospects: NewProspect[] = [];
  for (const result of results) {
    if (result.outcome !== "unlinked" || !("mention" in result)) continue;
    if (result.mention.kind !== "unlinked") continue;
    const domain = normaliseDomain(result.url);
    const key = domain ? dedupeKeyFor(domain) : null;
    if (!domain || !key) continue;
    prospects.push({
      dedupeKey: key,
      referringDomain: key,
      pageUrl: result.url,
      method: "brand_mention",
      campaignMode: "earned_editorial",
      status: "discovered",
      recommendation: "pursue",
      score: null,
      targetUrl: null,
      sourceRunId: null,
      notes:
        "The page names you in its text without linking. Ask for the mention to link to the page that fits.",
      signals: [
        {
          kind: "brand_mention",
          value: `…${result.mention.snippet}…`,
          url: result.url,
          source: "fetched_page",
          observedAt,
        },
      ],
    });
  }
  const saved = prospects.length
    ? await LinkProspectRepository.insertNew(
        ctx.projectId,
        prospects,
        actorOf(ctx),
        ctx.userId,
      )
    : { created: [], skipped: [] };
  return {
    checked: results.length,
    created: saved.created.length,
    alreadySaved: saved.skipped.length,
    alreadyLinked: results.filter((r) => r.outcome === "linked").length,
    notMentioned: results.filter((r) => r.outcome === "not_mentioned").length,
    unreadable: results.filter((r) => r.outcome === "unreadable").length,
  };
}

export const LinkDiscoveryService = {
  estimateRecovery,
  runRecovery,
  checkMentions,
};
