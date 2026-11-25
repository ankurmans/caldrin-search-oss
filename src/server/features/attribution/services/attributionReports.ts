import { sort } from "remeda";
import { addMoney, type Money } from "@/shared/attribution/money";
import { rangeBounds, type RangeKey } from "@/shared/attribution/ranges";
import {
  CHANNELS,
  EVIDENCE_LEVELS,
  MODEL_KEYS,
  narrow,
  type Channel,
  type Evidence,
  type ModelKey,
} from "@/shared/attribution/vocabulary";
import { AttributionLedgerRepository as ledger } from "../repositories/AttributionLedgerRepository";
import { AttributionReportRepository as reports } from "../repositories/AttributionReportRepository";

export type ReportQuery = {
  projectId: string;
  model?: ModelKey;
  range: RangeKey;
  demo: boolean;
  brandId?: string | null;
};

const BP = 10_000;
const MODEL_DEPENDENT_RATIO = 1.5;
const MAX_SOURCES = 25;
const JOURNEY_PAGE = 40;

/** Outcomes shown as funnel stages, in the order a buyer reaches them. */
const FUNNEL_KINDS = [
  "signup",
  "activation",
  "lead",
  "qualified_lead",
  "booking",
  "deal_won",
  "payment",
] as const;

export async function resolveScope(query: ReportQuery) {
  const settings = await ledger.getSettings(query.projectId);
  const model =
    query.model ??
    narrow(MODEL_KEYS, settings?.defaultModel ?? "") ??
    "last_non_direct";
  return {
    scope: {
      projectId: query.projectId,
      ...rangeBounds(query.range),
      demo: query.demo,
      brandId: query.brandId ?? null,
    },
    model,
    currency: settings?.reportingCurrency ?? "USD",
  };
}

type ChannelRow = {
  channel: Channel;
  visitors: number;
  /** Outcomes credited to the channel, by kind, as fractions of an outcome. */
  credited: Record<string, number>;
  revenue: Money[];
  /** Share of this channel's credit at each evidence level, in basis points. */
  evidenceBp: Record<Evidence, number>;
};

const revenueIn = (row: ChannelRow, currency: string) =>
  row.revenue.find((m) => m.currency === currency)?.minor ?? 0;
const totalCredited = (row: ChannelRow) =>
  Object.values(row.credited).reduce((s, v) => s + v, 0);

const emptyEvidence = (): Record<Evidence, number> => ({
  observed: 0,
  linked: 0,
  self_reported: 0,
  associated: 0,
  modelled: 0,
  unknown: 0,
});

/** The numbers on the Overview: outcomes, revenue by source, funnel and trend. */
export async function getAttributionOverview(query: ReportQuery) {
  const { scope, model, currency } = await resolveScope(query);
  const [totals, rollup, bySource, visitors, daily, unknown, demoAvailable] =
    await Promise.all([
      reports.conversionTotals(scope),
      reports.creditRollup(scope, { model }),
      reports.creditRollup(scope, { model, bySource: true }),
      reports.visitorsByChannel(scope),
      reports.dailyPayments(scope),
      reports.unattributedShare(scope, model),
      reports.hasDemoBatch(query.projectId),
    ]);

  const channels = new Map<Channel, ChannelRow>();
  const rowFor = (name: string) => {
    const channel = narrow(CHANNELS, name) ?? "unknown";
    let row = channels.get(channel);
    if (!row) {
      row = {
        channel,
        visitors: 0,
        credited: {},
        revenue: [],
        evidenceBp: emptyEvidence(),
      };
      channels.set(channel, row);
    }
    return row;
  };
  for (const v of visitors) rowFor(v.channel).visitors += v.visitors;
  for (const r of rollup) {
    const row = rowFor(r.channel);
    row.credited[r.kind] = (row.credited[r.kind] ?? 0) + r.bp / BP;
    addMoney(row.revenue, r.currency, Math.round(r.weighted / BP));
    const evidence = narrow(EVIDENCE_LEVELS, r.evidence) ?? "unknown";
    row.evidenceBp[evidence] += r.bp;
  }

  const sources = sort(
    bySource.filter((r) => r.kind === "payment" || r.kind === "lead"),
    (a, b) => b.weighted - a.weighted || b.bp - a.bp,
  );
  const sourceMap = new Map<
    string,
    {
      channel: Channel;
      source: string | null;
      credited: number;
      revenue: Money[];
    }
  >();
  for (const r of sources) {
    const key = `${r.channel}|${r.source ?? ""}`;
    const row = sourceMap.get(key) ?? {
      channel: narrow(CHANNELS, r.channel) ?? "unknown",
      source: r.source,
      credited: 0,
      revenue: [],
    };
    row.credited += r.bp / BP;
    addMoney(row.revenue, r.currency, Math.round(r.weighted / BP));
    sourceMap.set(key, row);
  }

  const kinds = new Map<
    string,
    { count: number; first: number; money: Money[]; gross: Money[] }
  >();
  for (const t of totals) {
    const row = kinds.get(t.kind) ?? {
      count: 0,
      first: 0,
      money: [],
      gross: [],
    };
    row.count += t.count;
    row.first += t.first;
    addMoney(row.money, t.currency, t.amount);
    addMoney(row.gross, t.currency, t.gross);
    kinds.set(t.kind, row);
  }

  const unknownShare = unknown.reduce(
    (acc, r) => ({
      unknown: acc.unknown + r.unknown,
      total: acc.total + r.total,
    }),
    { unknown: 0, total: 0 },
  );

  return {
    model,
    range: query.range,
    reportingCurrency: currency,
    demo: query.demo,
    demoAvailable,
    outcomes: FUNNEL_KINDS.map((kind) => ({
      kind,
      count: kinds.get(kind)?.count ?? 0,
      firstPayments: kinds.get(kind)?.first ?? 0,
      revenue: kinds.get(kind)?.money ?? [],
      refunded: (kinds.get(kind)?.gross ?? []).map((g) => ({
        currency: g.currency,
        minor:
          g.minor -
          (kinds.get(kind)?.money.find((m) => m.currency === g.currency)
            ?.minor ?? 0),
      })),
    })),
    channels: sort(
      [...channels.values()],
      (a, b) =>
        revenueIn(b, currency) - revenueIn(a, currency) ||
        totalCredited(b) - totalCredited(a),
    ),
    sources: [...sourceMap.values()].slice(0, MAX_SOURCES),
    daily,
    /** The share of credited outcomes with no recorded source, in basis points. */
    unknownBp:
      unknownShare.total === 0
        ? 0
        : Math.round((unknownShare.unknown / unknownShare.total) * BP),
  };
}

/** Every model's credit per channel for one kind of outcome, side by side. */
export async function compareAttributionModels(
  query: ReportQuery & { kind: string },
) {
  const { scope, currency } = await resolveScope(query);
  const rollup = (await reports.creditRollup(scope)).filter(
    (r) => r.kind === query.kind,
  );
  const cells = new Map<string, { credited: number; minor: number }>();
  for (const r of rollup) {
    if (r.currency && r.currency !== currency) continue;
    const key = `${r.channel}|${r.model}`;
    const cell = cells.get(key) ?? { credited: 0, minor: 0 };
    cell.credited += r.bp / BP;
    cell.minor += Math.round(r.weighted / BP);
    cells.set(key, cell);
  }
  const channels = CHANNELS.filter((c) =>
    MODEL_KEYS.some((m) => cells.has(`${c}|${m}`)),
  );
  const isMoney = query.kind === "payment" || query.kind === "deal_won";
  return {
    kind: query.kind,
    reportingCurrency: currency,
    models: MODEL_KEYS,
    rows: channels.map((channel) => {
      const modelCells = MODEL_KEYS.map((model) => ({
        model,
        ...(cells.get(`${channel}|${model}`) ?? { credited: 0, minor: 0 }),
      }));
      const values = modelCells.map((c) => (isMoney ? c.minor : c.credited));
      const low = Math.min(...values);
      const high = Math.max(...values);
      return {
        channel,
        cells: modelCells,
        low,
        high,
        // A channel the models disagree on by half again is a judgement call, not a finding.
        modelDependent: high > 0 && high >= low * MODEL_DEPENDENT_RATIO,
      };
    }),
  };
}

/** Recent outcomes with the source the chosen model gives each. */
export async function listJourneys(
  query: ReportQuery & { kinds?: string[]; before?: string },
) {
  const { scope, model } = await resolveScope(query);
  const rows = await reports.recentConversions(scope, {
    kinds: query.kinds,
    limit: JOURNEY_PAGE + 1,
    before: query.before,
  });
  const page = rows.slice(0, JOURNEY_PAGE);
  const credits = await reports.creditsForConversions(
    query.projectId,
    page.map((r) => r.id),
    model,
  );
  return {
    model,
    items: page.map((r) => {
      const own = sort(
        credits.filter((c) => c.conversionId === r.id),
        (a, b) => b.creditBp - a.creditBp,
      );
      return {
        id: r.id,
        kind: r.kind,
        occurredAt: r.occurredAt,
        amountMinor: r.amountMinor,
        currency: r.currency,
        isFirstPayment: r.isFirstPayment,
        credits: own.map((c) => ({
          channel: narrow(CHANNELS, c.channel) ?? "unknown",
          source: c.source,
          bp: c.creditBp,
          evidence: narrow(EVIDENCE_LEVELS, c.evidence) ?? "unknown",
        })),
      };
    }),
    next: rows.length > JOURNEY_PAGE ? (page.at(-1)?.occurredAt ?? null) : null,
  };
}
