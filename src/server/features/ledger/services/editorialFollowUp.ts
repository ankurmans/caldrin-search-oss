import { normalizeHost } from "@/shared/attribution/channels";
import { MODEL_KEYS, narrow } from "@/shared/attribution/vocabulary";
import { AttributionLandingRepository } from "@/server/features/attribution/repositories/AttributionLandingRepository";
import { AttributionLedgerRepository } from "@/server/features/attribution/repositories/AttributionLedgerRepository";
import type { LedgerEntry } from "../types";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 28;
const iso = (time: number) => new Date(time).toISOString();

export async function readEditorialFollowUp(
  entry: LedgerEntry,
  now = Date.now(),
) {
  const url = entry.targetUrl;
  if (
    !url ||
    !URL.canParse(url) ||
    !/^https?:\/\//i.test(url) ||
    !entry.executedAt ||
    entry.publicationStatus !== "published"
  ) {
    return {
      status: "unavailable" as const,
      note: "First-party follow-up starts after a verified publication.",
    };
  }
  const target = new URL(url);
  const executionDay = Date.parse(`${entry.executedAt.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(executionDay))
    return {
      status: "unavailable" as const,
      note: "Publication date is unavailable.",
    };
  // Compare complete UTC days on either side. Leave the release day out.
  const before = {
    from: iso(executionDay - WINDOW_DAYS * DAY_MS),
    to: iso(executionDay),
  };
  const after = {
    from: iso(executionDay + DAY_MS),
    to: iso(executionDay + (WINDOW_DAYS + 1) * DAY_MS),
  };
  const properties = await AttributionLedgerRepository.listProperties(
    entry.projectId,
  );
  const host = normalizeHost(target.hostname);
  if (
    !host ||
    !properties.some((property) => normalizeHost(property.host) === host)
  ) {
    return {
      status: "unavailable" as const,
      note: "The published website has no first-party attribution property.",
    };
  }
  if (now < Date.parse(after.to)) {
    return {
      status: "unavailable" as const,
      note: `The 28-day follow-up window completes on ${after.to.slice(0, 10)} UTC.`,
    };
  }
  if (entry.rolledBackAt && entry.rolledBackAt < after.to) {
    return {
      status: "unavailable" as const,
      note: "The draft was rolled back during the follow-up window.",
    };
  }
  const settings = await AttributionLedgerRepository.getSettings(
    entry.projectId,
  );
  const model =
    narrow(MODEL_KEYS, settings?.defaultModel ?? "") ?? "last_non_direct";
  const page = { host, path: target.pathname };
  const windows = await Promise.all(
    [before, after].map(async (window) => {
      const scope = { projectId: entry.projectId, ...window, demo: false };
      const [sessions, credits] = await Promise.all([
        AttributionLandingRepository.sessionsByLandingPage(scope, page),
        AttributionLandingRepository.creditsByLandingPage(scope, model, page),
      ]);
      const byEvidence = new Map<string, number>();
      for (const credit of credits) {
        const key = `${credit.kind} · ${credit.evidence}`;
        byEvidence.set(key, (byEvidence.get(key) ?? 0) + credit.bp / 10_000);
      }
      return {
        ...window,
        sessions: sessions.reduce((sum, row) => sum + row.sessions, 0),
        credits: [...byEvidence].map(([key, value]) => ({ key, value })),
      };
    }),
  );
  if (windows.some((window) => !window.sessions)) {
    return {
      status: "unavailable" as const,
      note: "One or both windows have no recorded visits for this landing page.",
    };
  }
  return { status: "measured" as const, model, windows };
}
