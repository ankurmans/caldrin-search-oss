import { sort } from "remeda";
import { AttributionLedgerRepository as ledger } from "../repositories/AttributionLedgerRepository";
import { AttributionConnectorRepository as connectors } from "../repositories/AttributionConnectorRepository";
import { AttributionReportRepository as reports } from "../repositories/AttributionReportRepository";
import { rangeBounds } from "@/shared/attribution/ranges";
import { MODEL_KEYS, narrow } from "@/shared/attribution/vocabulary";

const DAY_MS = 86_400_000;
const STALE_AFTER_MS = 3 * DAY_MS;
const UNKNOWN_WARN_BP = 4000;

type HealthCheck = {
  id: string;
  label: string;
  status: "ok" | "attention" | "off";
  detail: string;
};

/**
 * Whether the numbers can be trusted: is anything arriving, from where, how
 * much of the outcome is still unattributed, and what was refused. Each check
 * names what to do, not just that something is wrong.
 */
export async function getAttributionHealth(projectId: string, demo: boolean) {
  const now = Date.now();
  const since = new Date(now - 7 * DAY_MS).toISOString();
  const settings = await ledger.getSettings(projectId);
  const [
    properties,
    activity,
    rejections,
    conflicts,
    pending,
    batches,
    unknown,
    posthog,
  ] = await Promise.all([
    ledger.listProperties(projectId),
    reports.sourceActivity(projectId, since),
    reports.rejectionReasons(projectId, since),
    reports.conflictCount(projectId),
    ledger.countPending(projectId),
    reports.batches(projectId, demo, 10),
    reports.unattributedShare(
      { projectId, ...rangeBounds("28d"), demo },
      narrow(MODEL_KEYS, settings?.defaultModel ?? "") ?? "last_non_direct",
    ),
    connectors
      .list(projectId)
      .then((list) => list.filter((c) => c.kind === "posthog")),
  ]);

  const checks: HealthCheck[] = [];
  const browser = activity.filter((a) => a.origin === "browser");
  const server = activity.filter((a) => a.origin === "server");
  const webhooks = activity.filter((a) => a.origin === "webhook");

  checks.push(
    properties.length === 0
      ? {
          id: "properties",
          label: "Websites",
          status: "off",
          detail:
            "No website is registered. Add one in Project Settings, Integrations.",
        }
      : {
          id: "properties",
          label: "Websites",
          status: properties.every((p) => p.lastEventAt) ? "ok" : "attention",
          detail: properties
            .map((p) =>
              p.lastEventAt
                ? `${p.host}: last event ${p.lastEventAt.slice(0, 16).replace("T", " ")} UTC`
                : `${p.host}: no events yet`,
            )
            .join("; "),
        },
  );

  const latestBrowser = sort(
    browser.map((a) => a.latest),
    (a, b) => a.localeCompare(b),
  ).at(-1);
  checks.push({
    id: "tracker",
    label: "Tracker",
    status: !latestBrowser
      ? "off"
      : now - Date.parse(latestBrowser) > STALE_AFTER_MS
        ? "attention"
        : "ok",
    detail: latestBrowser
      ? `${browser.reduce((n, a) => n + a.count, 0)} browser events in 7 days; the latest arrived ${latestBrowser.slice(0, 16).replace("T", " ")} UTC.`
      : "No browser events in 7 days. Install the snippet on a registered site.",
  });
  checks.push({
    id: "backend",
    label: "Backend events",
    status: server.length + webhooks.length ? "ok" : "off",
    detail:
      server.length + webhooks.length
        ? `${[...server, ...webhooks].reduce((n, a) => n + a.count, 0)} signups, payments or other outcomes in 7 days.`
        : "No outcomes reported from a backend, a payment webhook or a file in 7 days. Without them nothing can be credited.",
  });

  if (posthog.length > 0 && !demo) {
    const coverage = await reports.posthogCoverage(projectId);
    const failing = posthog.find((c) => c.lastFailure);
    const lastImport = sort(
      posthog.flatMap((c) => (c.lastEventAt ? [c.lastEventAt] : [])),
      (a, b) => a.localeCompare(b),
    ).at(-1);
    const noSource = coverage.sessions - coverage.withSource;
    checks.push({
      id: "posthog",
      label: "PostHog",
      status: failing || !lastImport ? "attention" : "ok",
      detail: [
        lastImport
          ? `Last import ${lastImport.slice(0, 16).replace("T", " ")} UTC.`
          : "Connected, but nothing has been imported yet. Choose a date range and preview it first.",
        coverage.sessions > 0
          ? `${coverage.withSource} of ${coverage.sessions} imported sessions recorded where the visit came from; ${noSource} did not and stay Unknown. ${coverage.identifies} identify calls link visitors to user ids.`
          : "",
        failing ? `Last problem: ${failing.lastFailure}.` : "",
        "Imports run only when you start one; nothing is read in the background.",
      ]
        .filter(Boolean)
        .join(" "),
    });
  }

  const share = unknown.reduce(
    (acc, r) => ({
      unknown: acc.unknown + r.unknown,
      total: acc.total + r.total,
    }),
    { unknown: 0, total: 0 },
  );
  const unknownBp = share.total
    ? Math.round((share.unknown / share.total) * 10_000)
    : 0;
  checks.push({
    id: "unknown",
    label: "Outcomes with no recorded source",
    status:
      share.total === 0
        ? "off"
        : unknownBp > UNKNOWN_WARN_BP
          ? "attention"
          : "ok",
    detail:
      share.total === 0
        ? "No outcomes in the last 28 days."
        : `${(unknownBp / 100).toFixed(1)}% of credited outcomes in the last 28 days have no recorded source. They are shown as Unknown and never moved to a channel. Pass the visitor id with signups and payments to join them.`,
  });
  checks.push({
    id: "conflicts",
    label: "Refused identity joins",
    status: conflicts > 0 ? "attention" : "ok",
    detail:
      conflicts > 0
        ? `${conflicts} joins were refused because they would have merged two different users, for example a shared browser.`
        : "No identity join has been refused.",
  });
  checks.push({
    id: "queue",
    label: "Processing queue",
    status: pending > 500 ? "attention" : "ok",
    detail:
      pending > 0
        ? `${pending} events are waiting to be attributed; they are worked through on the next scheduled run.`
        : "Nothing is waiting.",
  });

  const rejected = rejections.reduce((n, r) => n + r.count, 0);
  checks.push({
    id: "rejections",
    label: "Refused events",
    status: rejected > 0 ? "attention" : "ok",
    detail: rejected
      ? `${rejected} events were refused in 7 days (${rejections.map((r) => `${r.reason}: ${r.count}`).join(", ")}).`
      : "Nothing was refused in 7 days.",
  });

  return {
    checks,
    sources: sort(activity, (a, b) => b.count - a.count),
    rejections: sort(rejections, (a, b) => b.count - a.count),
    batches: batches.map((b) => ({
      id: b.id,
      label: b.label,
      sourceSystem: b.sourceSystem,
      isDemo: b.isDemo,
      createdAt: b.createdAt,
      accepted: b.acceptedCount,
      duplicate: b.duplicateCount,
      rejected: b.rejectedCount,
    })),
  };
}
