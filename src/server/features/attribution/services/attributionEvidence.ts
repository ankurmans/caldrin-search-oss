import { sort } from "remeda";
import {
  CHANNELS,
  EVIDENCE_LEVELS,
  MODEL_KEYS,
  narrow,
} from "@/shared/attribution/vocabulary";
import { AttributionIdentityRepository as identity } from "../repositories/AttributionIdentityRepository";
import { AttributionLedgerRepository as ledger } from "../repositories/AttributionLedgerRepository";
import { AttributionResultsRepository as results } from "../repositories/AttributionResultsRepository";

const DAY_MS = 86_400_000;

/**
 * Everything behind one outcome's credit: the event that reported it, the
 * identities joined to it and why, each touchpoint in the window and the rule
 * that classified it, and what every model gave each touchpoint. Nothing here
 * is recomputed for display; it is what the credit was derived from.
 */
export async function getConversionEvidence(
  projectId: string,
  conversionId: string,
) {
  const conversion = await results.getConversion(projectId, conversionId);
  if (!conversion) return null;
  const [event] = await ledger.getEvents([conversion.eventId]);
  const credits = await results.creditsOf(projectId, conversionId);
  const run = credits[0]
    ? await results.getRun(projectId, credits[0].runId)
    : null;
  const lookbackDays = run?.lookbackDays ?? 90;

  const ownIdentifiers = await ledger.identifiersOf([conversion.eventId]);
  const nodes = conversion.subjectId.startsWith("ev:")
    ? []
    : await identity.nodesOfSubjects(projectId, [conversion.subjectId]);
  const anchors = nodes.map((n) => ({ type: n.nodeType, value: n.nodeValue }));
  if (conversion.subjectId.startsWith("ev:"))
    anchors.push({ type: "event", value: conversion.subjectId.slice(3) });
  const touchpoints = anchors.length
    ? await results.touchpointsFor(
        projectId,
        anchors,
        new Date(
          Date.parse(conversion.occurredAt) - lookbackDays * DAY_MS,
        ).toISOString(),
        conversion.occurredAt,
      )
    : [];
  const links = nodes.length
    ? await identity.linksTouching(
        projectId,
        nodes.map((n) => ({ type: n.nodeType, value: n.nodeValue })),
      )
    : [];
  const batch = event?.importBatchId
    ? (await ledger.listBatchesByIds([event.importBatchId]))[0]
    : null;

  const own = new Set(ownIdentifiers.map((i) => i.value));
  const notes: string[] = [];
  if (!touchpoints.length)
    notes.push(
      `No source was recorded for this outcome in the ${lookbackDays} days before it, so it stays unknown. It is not given to any channel.`,
    );
  if (links.some((l) => l.status === "conflict"))
    notes.push(
      "A join to another identity was refused because it would have put two different users in one person. That identity's touchpoints are not used.",
    );
  if (conversion.isDemo) notes.push("This is labelled demo data.");
  if (event?.isTest) notes.push("This event was marked as a test.");

  return {
    conversion: {
      id: conversion.id,
      kind: conversion.kind,
      occurredAt: conversion.occurredAt,
      amountMinor: conversion.amountMinor,
      grossMinor: conversion.grossMinor,
      currency: conversion.currency,
      isFirstPayment: conversion.isFirstPayment,
      isDemo: conversion.isDemo,
    },
    event: event
      ? {
          sourceSystem: event.sourceSystem,
          sourceEventId: event.sourceEventId,
          origin: event.origin,
          occurredAt: event.occurredAt,
          ingestedAt: event.ingestedAt,
          isTest: event.isTest,
          selfReportedSource: event.selfReportedSource,
          stage: event.stage,
          hasPayload: Boolean(event.payload || event.payloadKey),
          batch: batch
            ? { id: batch.id, label: batch.label, createdAt: batch.createdAt }
            : null,
        }
      : null,
    identifiers: ownIdentifiers.map((i) => ({
      type: i.identifierType,
      value: i.value,
    })),
    identities: nodes.map((n) => ({
      type: n.nodeType,
      value: n.nodeValue,
      firstSeenAt: n.firstSeenAt,
    })),
    links: links.map((l) => ({
      id: l.id,
      a: `${l.aType}:${l.aValue}`,
      b: `${l.bType}:${l.bValue}`,
      status: l.status,
      reason: l.reason,
      createdAt: l.createdAt,
    })),
    touchpoints: touchpoints.map((t) => ({
      id: t.id,
      occurredAt: t.occurredAt,
      kind: t.kind,
      channel: narrow(CHANNELS, t.channel) ?? "unknown",
      source: t.source,
      ruleId: t.ruleId,
      landing: t.landingHost ? `${t.landingHost}${t.landingPath ?? ""}` : null,
      referrerHost: t.referrerHost,
      campaign: t.utmCampaign,
      selfReportedText: t.selfReportedText,
      sharedId: t.eventId === conversion.eventId || own.has(t.anchorValue),
    })),
    models: MODEL_KEYS.map((model) => ({
      model,
      credits: sort(
        credits.filter((c) => c.modelKey === model),
        (a, b) => b.creditBp - a.creditBp,
      ).map((c) => ({
        touchpointId: c.touchpointId,
        channel: narrow(CHANNELS, c.channel) ?? "unknown",
        source: c.source,
        bp: c.creditBp,
        evidence: narrow(EVIDENCE_LEVELS, c.evidence) ?? "unknown",
      })),
    })),
    run: run
      ? {
          modelVersion: run.modelVersion,
          lookbackDays: run.lookbackDays,
          createdAt: run.createdAt,
          reason: run.reason,
        }
      : null,
    notes,
  };
}
