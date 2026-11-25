import { Ga4ConnectionRepository } from "@/server/features/ga4/repositories/Ga4ConnectionRepository";
import { organicFilter } from "@/server/features/ga4/services/Ga4ReportDefinitions";
import { normalizeGa4Response } from "@/server/features/ga4/services/Ga4ReportNormalization";
import { mapGa4ReportError } from "@/server/features/ga4/services/Ga4ReportingService";
import {
  createGa4DataClient,
  type Ga4RunReportRequest,
} from "@/server/lib/ga4Client";
import { Ga4ReportError } from "@/server/lib/ga4Errors";
import { LedgerRepository } from "../repositories/LedgerRepository";
import {
  aggregateGa4Rows,
  ga4ObservationsFromTotals,
  ga4PageFilterFor,
} from "../rules/ga4Windows";
import { planGscWindows } from "../rules/gscWindows";
import type { DayWindow } from "../rules/gscWindows";
import { requireMeasurable } from "../rules/measurable";
import {
  ATTRIBUTION_NOTE,
  LedgerRefusal,
  type CollectGa4Result,
  type LedgerEntry,
  type WindowOutcome,
} from "../types";

// Search Console and Google Analytics are measured over the same windows, so
// the two sources can be read side by side. Read-only: this only calls the
// Analytics reporting API, and nothing here writes to the store.

type Phase = "baseline" | "follow_up";
type DataClient = ReturnType<typeof createGa4DataClient>;

const ROW_LIMIT = 1000;

function unavailable(window: DayWindow, note: string): WindowOutcome {
  return { status: "unavailable", window, recorded: 0, note };
}

function request(
  window: DayWindow,
  shape: Pick<
    Ga4RunReportRequest,
    "dimensions" | "metrics" | "dimensionFilter" | "orderBys" | "limit"
  >,
): Ga4RunReportRequest {
  return {
    dateRanges: [{ startDate: window.start, endDate: window.end }],
    offset: "0",
    keepEmptyRows: false,
    returnPropertyQuota: true,
    ...shape,
  };
}

function pageRequest(window: DayWindow, targetUrl: string) {
  const { filter } = ga4PageFilterFor(targetUrl);
  return request(window, {
    dimensions: [{ name: "landingPage" }],
    metrics: [
      { name: "sessions" },
      { name: "transactions" },
      { name: "purchaseRevenue" },
    ],
    dimensionFilter: {
      andGroup: { expressions: [organicFilter(), { filter }] },
    },
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: String(ROW_LIMIT),
  });
}

// Whether the property records purchases at all, over all channels. Without
// this a store-less property would get a "0 revenue" reading that means nothing.
function ecommerceProbeRequest(window: DayWindow) {
  return request(window, {
    dimensions: [],
    metrics: [{ name: "transactions" }],
    orderBys: [],
    limit: "1",
  });
}

// The reporting layer's own explanation for a failed read (reconnect needed,
// quota, property gone). Anything it does not recognize is a bug and rethrown.
function ga4Failure(error: unknown): Ga4ReportError {
  try {
    return mapGa4ReportError(error);
  } catch (mapped) {
    if (mapped instanceof Ga4ReportError) return mapped;
    throw mapped;
  }
}

function numberOf(value: string | number | null | undefined): number {
  return typeof value === "number" ? value : 0;
}

async function readAndRecord(input: {
  client: DataClient;
  entry: LedgerEntry;
  targetUrl: string;
  phase: Phase;
  window: DayWindow;
  note: string | null;
}): Promise<WindowOutcome> {
  const { client, entry, targetUrl, phase, window } = input;
  const page = pageRequest(window, targetUrl);
  const probe = ecommerceProbeRequest(window);
  let totals;
  let hasEcommerce: boolean;
  let limited: boolean;
  try {
    const [pageResponse, probeResponse] = await Promise.all([
      client.runReport(page),
      client.runReport(probe),
    ]);
    const pageReport = normalizeGa4Response(pageResponse, page);
    const probeReport = normalizeGa4Response(probeResponse, probe);
    const { keepRow } = ga4PageFilterFor(targetUrl);
    totals = aggregateGa4Rows(
      pageReport.rows
        .filter((row) => keepRow(String(row.landingPage ?? "")))
        .map((row) => ({
          landingPage: String(row.landingPage ?? ""),
          sessions: numberOf(row.sessions),
          transactions: numberOf(row.transactions),
          purchaseRevenue: numberOf(row.purchaseRevenue),
        })),
    );
    hasEcommerce = numberOf(probeReport.rows[0]?.transactions) > 0;
    limited =
      pageReport.reportMetadata.hasLimitedData ||
      probeReport.reportMetadata.hasLimitedData;
  } catch (error) {
    return unavailable(window, ga4Failure(error).message);
  }

  if (!totals) {
    // No sessions is a finding about the window, not a zero to store.
    return {
      status: "no_data",
      window,
      recorded: 0,
      note: "Google Analytics returned no organic sessions landing on this page in the window.",
    };
  }
  const notes = [
    input.note,
    limited
      ? "Google Analytics reported thresholded or sampled data for this window."
      : null,
    hasEcommerce
      ? null
      : "No ecommerce transactions were recorded for this property in the window, so revenue is not reported.",
  ].filter((part): part is string => part !== null);
  const note = notes.length > 0 ? notes.join(" ") : null;

  let recorded = 0;
  for (const draft of ga4ObservationsFromTotals(totals, hasEcommerce)) {
    const probeKey = {
      phase,
      source: "ga4" as const,
      metric: draft.metric,
      windowStart: window.start,
      windowEnd: window.end,
    };
    if (await LedgerRepository.hasObservation(entry.id, probeKey)) continue;
    await LedgerRepository.insertObservation(entry.id, {
      ...probeKey,
      value: draft.value,
      numerator: draft.numerator,
      denominator: draft.denominator,
      note,
    });
    recorded += 1;
  }
  return {
    status: recorded > 0 ? "recorded" : "already_recorded",
    window,
    recorded,
    note,
  };
}

export async function collectGa4Observations(input: {
  projectId: string;
  entryId: string;
  now?: Date;
}): Promise<CollectGa4Result> {
  const { projectId, entryId, now = new Date() } = input;
  const entry = await LedgerRepository.getEntry(projectId, entryId);
  if (!entry) throw new LedgerRefusal("Change not found.");
  const { targetUrl, executedAt } = requireMeasurable(entry);
  const plan = planGscWindows(executedAt, now);
  if (!plan) throw new LedgerRefusal("This change has no execution time.");

  let client: DataClient | null | undefined;
  const read = async (
    phase: Phase,
    window: DayWindow,
    note: string | null,
  ): Promise<WindowOutcome> => {
    if (client === undefined) {
      const connection =
        await Ga4ConnectionRepository.getByProjectId(projectId);
      client = connection
        ? createGa4DataClient({
            userId: connection.connectedByUserId,
            ga4AccountId: connection.ga4AccountId,
            propertyId: connection.propertyId,
          })
        : null;
    }
    if (!client) {
      return unavailable(
        window,
        "Connect Google Analytics for this project to measure this change.",
      );
    }
    return readAndRecord({
      client,
      entry,
      targetUrl,
      phase,
      window,
      note,
    });
  };

  const baseline: WindowOutcome = plan.baselineReady
    ? await read("baseline", plan.baseline, null)
    : {
        status: "too_early",
        window: plan.baseline,
        recorded: 0,
        note: "The days before the change are not complete in Google Analytics yet.",
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
    followUp = await read(
      "follow_up",
      window,
      daysBeforeChange > 0
        ? `${daysBeforeChange} days of this window are before the change.`
        : null,
    );
  }
  return {
    baseline,
    followUp,
    attribution: "observed_only",
    attributionNote: ATTRIBUTION_NOTE,
  };
}
