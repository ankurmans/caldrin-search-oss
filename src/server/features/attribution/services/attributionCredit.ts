import { sort } from "remeda";
import { computeCredits, type Touch } from "@/shared/attribution/models";
import {
  CHANNELS,
  MODEL_KEYS,
  MODEL_VERSION,
  narrow,
} from "@/shared/attribution/vocabulary";
import { sha256Hex } from "@/server/lib/audit/ids";
import { AttributionLedgerRepository as ledger } from "../repositories/AttributionLedgerRepository";
import { AttributionResultsRepository as results } from "../repositories/AttributionResultsRepository";
import { nodesOfSubjects } from "./attributionIdentity";

const TOUCH_KINDS = ["session", "self_reported", "call"] as const;
const DAY_MS = 86_400_000;

export type CreditContext = {
  projectId: string;
  lookbackDays: number;
  runId: string;
};

/**
 * The model configuration credits are computed under. A run row is kept for
 * every distinct configuration, so a number can be tied to the lookback, model
 * version and source rules that produced it, and a change to them is visible.
 */
export async function ensureModelRun(
  projectId: string,
  lookbackDays: number,
  reason: string,
  userId?: string,
) {
  const rules = sort(
    (await ledger.listSourceRules(projectId)).map(
      (r) => `${r.matchKind}|${r.pattern}|${r.channel}|${r.sourceLabel}`,
    ),
    (a, b) => a.localeCompare(b),
  );

  const parameters = JSON.stringify({
    models: MODEL_KEYS,
    positionWeights: [40, 20, 40],
    timeDecayHalfLifeDays: 7,
    sourceRules: rules,
  });
  const latest = await results.latestRun(projectId);
  if (
    latest &&
    latest.lookbackDays === lookbackDays &&
    latest.modelVersion === MODEL_VERSION &&
    latest.parameters === parameters
  )
    return latest.id;
  const id = crypto.randomUUID();
  await results.insertRun({
    id,
    projectId,
    modelVersion: MODEL_VERSION,
    lookbackDays,
    parameters,
    reason: latest ? reason : "initial",
    createdAt: new Date().toISOString(),
    createdBy: userId ?? null,
  });
  return id;
}

/**
 * Recomputes every model's credit for a conversion from the touchpoints
 * recorded for its subject. Nothing is read from outside the project.
 */
export async function recomputeConversion(
  ctx: CreditContext,
  conversion: Awaited<ReturnType<typeof results.getConversionByEvent>> & {},
) {
  const end = Date.parse(conversion.occurredAt);
  const from = new Date(end - ctx.lookbackDays * DAY_MS).toISOString();
  const nodes = conversion.subjectId.startsWith("ev:")
    ? []
    : await nodesOfSubjects(ctx.projectId, [conversion.subjectId]);
  const anchors = nodes.map((n) => ({ type: n.nodeType, value: n.nodeValue }));
  if (conversion.subjectId.startsWith("ev:"))
    anchors.push({ type: "event", value: conversion.subjectId.slice(3) });
  const touchRows = anchors.length
    ? await results.touchpointsFor(
        ctx.projectId,
        anchors,
        from,
        conversion.occurredAt,
      )
    : [];
  const own = new Set(
    (await ledger.identifiersOf([conversion.eventId])).map((i) => i.value),
  );
  const touches: Touch[] = touchRows.map((t) => ({
    id: t.id,
    occurredAt: t.occurredAt,
    channel: narrow(CHANNELS, t.channel) ?? "unknown",
    source: t.source,
    kind: narrow(TOUCH_KINDS, t.kind) ?? "session",
    linkDepth:
      t.eventId === conversion.eventId || own.has(t.anchorValue) ? 0 : 1,
  }));

  const credits = [];
  for (const model of MODEL_KEYS) {
    for (const credit of computeCredits(
      model,
      conversion.occurredAt,
      touches,
      ctx.lookbackDays,
    )) {
      credits.push({
        id: (
          await sha256Hex(
            `${conversion.id}|${model}|${credit.touchpointId ?? "unknown"}`,
          )
        ).slice(0, 36),
        projectId: ctx.projectId,
        conversionId: conversion.id,
        modelKey: model,
        runId: ctx.runId,
        touchpointId: credit.touchpointId,
        channel: credit.channel,
        source: credit.source,
        creditBp: credit.creditBp,
        evidence: credit.evidence,
        conversionKind: conversion.kind,
        occurredAt: conversion.occurredAt,
        brandId: conversion.brandId,
        amountMinor: conversion.amountMinor,
        currency: conversion.currency,
      });
    }
  }
  await results.replaceCredits([{ conversionId: conversion.id, credits }]);
}
