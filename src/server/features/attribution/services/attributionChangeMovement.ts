import { LedgerService } from "@/server/features/ledger/services/LedgerService";
import { ATTRIBUTION_NOTE } from "@/server/features/ledger/types";
import { addMoney, type Money } from "@/shared/attribution/money";
import { AttributionLandingRepository as landing } from "../repositories/AttributionLandingRepository";
import { resolveScope, type ReportQuery } from "./attributionReports";

const DAY_MS = 86_400_000;
const BP = 10_000;
const DEFAULT_WINDOW_DAYS = 28;
const MIN_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 90;

const MOVEMENT_LABEL = "Observed movement";
const MOVEMENT_NOTE = `${ATTRIBUTION_NOTE} Other changes, seasonality and traffic mix can move the same numbers, so compare per-day figures and read an unfinished window as partial.`;

const normalizePath = (path: string) =>
  path.length > 1 ? path.replace(/\/+$/, "") : path;

function matches(targetUrl: string, host: string, path: string) {
  try {
    const url = new URL(targetUrl);
    return (
      url.hostname.toLowerCase().replace(/^www\./, "") === host &&
      normalizePath(url.pathname || "/") === normalizePath(path)
    );
  } catch {
    return false;
  }
}

type Window = {
  from: string;
  to: string;
  days: number;
  sessions: number;
  outcomes: number;
  revenue: Money[];
  sessionsPerDay: number;
  outcomesPerDay: number;
};

/**
 * Before and after readings of first-party landing outcomes around each
 * executed Change Ledger entry for a page. This is recorded movement: it is
 * labelled as such and never as an effect of the change.
 */
export async function getChangeMovement(
  query: ReportQuery & { host: string; path: string },
) {
  const { scope, model, currency } = await resolveScope(query);
  const entries = (await LedgerService.listEntries(query.projectId)).filter(
    (e) =>
      e.status === "executed" &&
      e.executedAt &&
      e.targetUrl &&
      matches(e.targetUrl, query.host, query.path),
  );
  const now = Date.now();

  const read = async (fromMs: number, toMs: number): Promise<Window> => {
    const from = new Date(fromMs).toISOString();
    const to = new Date(toMs).toISOString();
    const range = { ...scope, from, to };
    const filter = { host: query.host, path: query.path };
    const [credits, sessions] = await Promise.all([
      landing.creditsByLandingPage(range, model, filter),
      landing.sessionsByLandingPage(range, filter),
    ]);
    const revenue: Money[] = [];
    let outcomes = 0;
    for (const c of credits) {
      outcomes += c.bp / BP;
      addMoney(revenue, c.currency, Math.round(c.weighted / BP));
    }
    const count = sessions.reduce((n, s) => n + s.sessions, 0);
    const days = Math.max(1, (toMs - fromMs) / DAY_MS);
    return {
      from,
      to,
      days: Math.round(days * 10) / 10,
      sessions: count,
      outcomes: Math.round(outcomes * 100) / 100,
      revenue,
      sessionsPerDay: Math.round((count / days) * 100) / 100,
      outcomesPerDay: Math.round((outcomes / days) * 1000) / 1000,
    };
  };

  const changes = await Promise.all(
    entries.map(async (entry) => {
      const at = Date.parse(entry.executedAt ?? "");
      const windowDays = Math.min(
        MAX_WINDOW_DAYS,
        Math.max(
          MIN_WINDOW_DAYS,
          entry.measurementWindowDays ?? DEFAULT_WINDOW_DAYS,
        ),
      );
      const fullAfter = at + windowDays * DAY_MS;
      const [before, after] = await Promise.all([
        read(at - windowDays * DAY_MS, at),
        read(at, Math.min(fullAfter, now)),
      ]);
      return {
        entryId: entry.id,
        kind: entry.kind,
        proposedAction: entry.proposedAction,
        executedAt: entry.executedAt,
        windowDays,
        before,
        after,
        afterComplete: fullAfter <= now,
        // Another change to the same page inside either window muddies the reading.
        overlapping: entries
          .filter(
            (other) =>
              other.id !== entry.id &&
              Math.abs(Date.parse(other.executedAt ?? "") - at) <
                windowDays * DAY_MS,
          )
          .map((other) => other.id),
      };
    }),
  );

  return {
    label: MOVEMENT_LABEL,
    note: MOVEMENT_NOTE,
    model,
    reportingCurrency: currency,
    changes,
  };
}
