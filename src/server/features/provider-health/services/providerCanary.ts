import {
  fetchBacklinksRows,
  type BacklinksItem,
} from "@/server/lib/dataforseo/backlinks";
import { fetchBacklinksDomainIntersection } from "@/server/lib/dataforseo/backlinksIntersection";
import { describeFailure } from "../rules/describeFailure";
import { ProviderHealthRepository } from "../repositories/ProviderHealthRepository";

// Large, long-lived public sites, so each read returns rows for years. The
// canary sends the same request shapes the product sends and checks the
// answer still has the fields the product reads. It costs a few cents a week.
const TARGET = "wikipedia.org";
// The first target returns no broken links, so that check reads another.
const BROKEN_TARGET = "archive.org";
const COMPETITORS = ["wikimedia.org", "mozilla.org", "archive.org"];

type Check = {
  operation: string;
  run: () => Promise<{ rows: number; usable: boolean }>;
};

const hasLinkFields = (items: BacklinksItem[]) =>
  items.length > 0 &&
  items.every((item) => !!item.url_from && !!item.url_to && !!item.domain_from);

const CHECKS: Check[] = [
  {
    // The link gap: three sort rules is the most the provider accepts.
    operation: "canary_domain_intersection",
    run: async () => {
      const { data } = await fetchBacklinksDomainIntersection({
        targets: COMPETITORS,
        excludeTargets: [TARGET],
        mode: "partial",
        status: "live",
        includeSubdomains: true,
        limit: 1,
        orderBy: ["1.rank,desc", "2.rank,desc", "3.rank,desc"],
      });
      return {
        rows: data.items.length,
        usable: data.items.every(
          (item) => Object.keys(item.domain_intersection).length > 0,
        ),
      };
    },
  },
  {
    // Exact linking pages, as read for evidence and lost-link recovery.
    operation: "canary_backlinks_lost",
    run: async () => {
      const { data } = await fetchBacklinksRows({
        target: TARGET,
        includeSubdomains: true,
        status: "lost",
        mode: "one_per_domain",
        limit: 1,
        hideSpam: false,
        orderBy: ["rank,desc"],
      });
      return { rows: data.items.length, usable: hasLinkFields(data.items) };
    },
  },
  {
    // Broken-link recovery filters on is_broken.
    operation: "canary_backlinks_broken",
    run: async () => {
      const { data } = await fetchBacklinksRows({
        target: BROKEN_TARGET,
        includeSubdomains: true,
        status: "live",
        mode: "one_per_domain",
        limit: 1,
        hideSpam: false,
        orderBy: ["rank,desc"],
        filters: ["is_broken", "=", true],
      });
      return { rows: data.items.length, usable: hasLinkFields(data.items) };
    },
  },
];

/** Runs each check once and records the outcome. A check never throws. */
export async function runProviderCanary() {
  const checks: Array<{
    operation: string;
    ok: boolean;
    kind: string | null;
    message: string | null;
  }> = [];
  for (const check of CHECKS) {
    let outcome: (typeof checks)[number];
    try {
      const { rows, usable } = await check.run();
      outcome =
        rows > 0 && usable
          ? { operation: check.operation, ok: true, kind: null, message: null }
          : {
              operation: check.operation,
              ok: false,
              kind: "invalid_response",
              message:
                rows === 0
                  ? "The read returned no rows for a target that always has them."
                  : "A returned row is missing a field the product reads.",
            };
    } catch (error) {
      const failure = describeFailure(error);
      outcome = {
        operation: check.operation,
        ok: false,
        kind: failure.kind,
        message: failure.message,
      };
    }
    checks.push(outcome);
    await ProviderHealthRepository.insert({
      createdAt: new Date().toISOString(),
      provider: "dataforseo",
      operation: outcome.operation,
      source: "canary",
      ok: outcome.ok,
      kind: outcome.kind,
      message: outcome.message,
    });
  }
  return { checks };
}
