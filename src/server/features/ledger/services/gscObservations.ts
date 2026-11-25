import { GscService } from "@/server/features/gsc/services/GscService";
import { GscNotConnectedError } from "@/server/lib/gscErrors";
import { LedgerRepository } from "../repositories/LedgerRepository";
import { requireMeasurable } from "../rules/measurable";
import {
  aggregateGscRows,
  observationsFromTotals,
  pageFilterFor,
  planGscWindows,
} from "../rules/gscWindows";
import type { DayWindow } from "../rules/gscWindows";
import {
  ATTRIBUTION_NOTE,
  LedgerRefusal,
  type CollectGscResult,
  type LedgerEntry,
  type WindowOutcome,
} from "../types";

const ROW_LIMIT = 100;

type Phase = "baseline" | "follow_up";

function unavailable(window: DayWindow, note: string): WindowOutcome {
  return { status: "unavailable", window, recorded: 0, note };
}

async function readAndRecord(input: {
  projectId: string;
  entry: LedgerEntry;
  targetUrl: string;
  phase: Phase;
  window: DayWindow;
  note: string | null;
}): Promise<WindowOutcome> {
  const { projectId, entry, targetUrl, phase, window, note } = input;
  const { filter, keepRow } = pageFilterFor(targetUrl);
  let rows;
  try {
    const result = await GscService.getPerformance({
      projectId,
      dimensions: ["page"],
      startDate: window.start,
      endDate: window.end,
      filters: [{ dimension: "page", ...filter }],
      rowLimit: ROW_LIMIT,
    });
    rows = result.rows;
  } catch (error) {
    if (error instanceof GscNotConnectedError) {
      return unavailable(
        window,
        "Connect Search Console for this project to measure this change.",
      );
    }
    return unavailable(window, "Search Console could not be read.");
  }

  const totals = aggregateGscRows(
    rows.filter((row) => keepRow(row.keys?.[0] ?? "")),
  );
  if (!totals) {
    // No impressions is a finding about the window, not a zero to store.
    return {
      status: "no_data",
      window,
      recorded: 0,
      note: "Search Console returned no impressions for this page in the window.",
    };
  }

  let recorded = 0;
  for (const draft of observationsFromTotals(totals)) {
    const probe = {
      phase,
      source: "gsc" as const,
      metric: draft.metric,
      windowStart: window.start,
      windowEnd: window.end,
    };
    if (await LedgerRepository.hasObservation(entry.id, probe)) continue;
    await LedgerRepository.insertObservation(entry.id, {
      ...probe,
      value: draft.value,
      numerator: draft.numerator,
      denominator: draft.denominator,
      note,
    });
    recorded += 1;
  }
  if (phase === "baseline") {
    await LedgerRepository.setBaselineWindow(projectId, entry.id, window);
  }
  return {
    status: recorded > 0 ? "recorded" : "already_recorded",
    window,
    recorded,
    note,
  };
}

export async function collectGscObservations(
  projectId: string,
  entry: LedgerEntry,
  now: Date,
): Promise<CollectGscResult> {
  const { targetUrl, executedAt } = requireMeasurable(entry);
  const plan = planGscWindows(executedAt, now);
  if (!plan) throw new LedgerRefusal("This change has no execution time.");
  const base = { projectId, entry, targetUrl };

  const baseline: WindowOutcome = plan.baselineReady
    ? await readAndRecord({
        ...base,
        phase: "baseline",
        window: plan.baseline,
        note: null,
      })
    : {
        status: "too_early",
        window: plan.baseline,
        recorded: 0,
        note: "Search Console has not published the days before the change yet.",
      };

  let followUp: WindowOutcome;
  if (plan.followUp.status === "too_early") {
    followUp = {
      status: "too_early",
      window: null,
      recorded: 0,
      note: `Follow-up measurement starts on ${plan.followUp.readyOn}.`,
    };
  } else {
    const { window, daysBeforeChange } = plan.followUp;
    followUp = await readAndRecord({
      ...base,
      phase: "follow_up",
      window,
      note:
        daysBeforeChange > 0
          ? `${daysBeforeChange} days of this window are before the change.`
          : null,
    });
  }
  return {
    baseline,
    followUp,
    attribution: "observed_only",
    attributionNote: ATTRIBUTION_NOTE,
  };
}
