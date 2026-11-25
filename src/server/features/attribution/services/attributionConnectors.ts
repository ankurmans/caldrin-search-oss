import { openSecret, sealSecret } from "@/server/lib/secret-box";
import { normalizePolarEvent, verifyPolarSignature } from "../adapters/polar";
import {
  normalizeStripeEvent,
  verifyStripeSignature,
} from "../adapters/stripe";
import { AttributionConnectorRepository as repo } from "../repositories/AttributionConnectorRepository";
import { AttributionLedgerRepository as ledger } from "../repositories/AttributionLedgerRepository";
import { ingestNormalized } from "./attributionIngest";

const MAX_CONNECTORS = 5;

/** What the settings page shows. The signing secret is never returned. */
export async function listAttributionConnectors(projectId: string) {
  return (await repo.list(projectId)).map((c) => ({
    id: c.id,
    kind: c.kind,
    label: c.label,
    createdAt: c.createdAt,
    lastEventAt: c.lastEventAt,
    failedCount: c.failedCount,
    lastFailureAt: c.lastFailureAt,
    lastFailure: c.lastFailure,
  }));
}

async function createConnector(
  projectId: string,
  kind: "stripe" | "polar",
  input: { label: string; signingSecret: string },
) {
  if ((await repo.list(projectId)).length >= MAX_CONNECTORS)
    throw new Error(`A project can have up to ${MAX_CONNECTORS} connectors`);
  const id = crypto.randomUUID();
  await repo.insert({
    id,
    projectId,
    kind,
    label: input.label,
    sealedSecret: await sealSecret(input.signingSecret),
    createdAt: new Date().toISOString(),
  });
  return { id };
}

export async function createStripeConnector(
  projectId: string,
  input: { label: string; signingSecret: string },
) {
  if (!/^whsec_[A-Za-z0-9]{16,}$/.test(input.signingSecret))
    throw new Error("A Stripe signing secret starts with whsec_");
  return createConnector(projectId, "stripe", input);
}

export async function createPolarConnector(
  projectId: string,
  input: { label: string; signingSecret: string },
) {
  if (!/^[A-Za-z0-9_+/=-]{16,200}$/.test(input.signingSecret))
    throw new Error("Paste the signing secret Polar showed for the endpoint");
  return createConnector(projectId, "polar", input);
}

export const removeAttributionConnector = (projectId: string, id: string) =>
  repo.remove(projectId, id);

type DeliveryResult = {
  status: 200 | 400 | 404 | 503;
  body: Record<string, unknown>;
};

type Verdict = {
  verified: (secret: string) => Promise<boolean>;
  normalize: (
    projectId: string,
    json: unknown,
  ) =>
    | ReturnType<typeof normalizeStripeEvent>
    | Promise<ReturnType<typeof normalizeStripeEvent>>;
};

/**
 * Handles one payment webhook delivery. A request that does not carry a valid
 * signature changes nothing but the connector's failure count.
 */
async function handleDelivery(
  kind: "stripe" | "polar",
  connectorId: string,
  rawBody: string,
  { verified, normalize }: Verdict,
): Promise<DeliveryResult> {
  const connector = await repo.get(connectorId);
  if (!connector || connector.kind !== kind)
    return { status: 404, body: { error: "not_found" } };
  const now = new Date().toISOString();
  const secret = await openSecret(connector.sealedSecret);
  if (!secret) {
    await repo.recordFailure(connector.id, now, "signing secret unreadable");
    return { status: 503, body: { error: "secret_unreadable" } };
  }
  if (!(await verified(secret))) {
    await repo.recordFailure(connector.id, now, "bad signature");
    return { status: 400, body: { error: "bad_signature" } };
  }
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    await repo.recordFailure(connector.id, now, "body is not JSON");
    return { status: 400, body: { error: "invalid_json" } };
  }
  const outcome = await normalize(connector.projectId, json);
  if (outcome.kind === "invalid") {
    await repo.recordFailure(connector.id, now, outcome.reason);
    return { status: 400, body: { error: outcome.reason } };
  }
  await repo.recordEvent(connector.id, now);
  if (outcome.kind === "ignored")
    return { status: 200, body: { ignored: outcome.reason } };
  const day = now.slice(0, 10);
  const result = await ingestNormalized(
    connector.projectId,
    {
      sourceSystem: kind,
      label: `${connector.label} ${day}`,
      batchId: `${kind}-${connector.id}-${day}`,
    },
    [outcome.event],
  );
  return {
    status: 200,
    body: { accepted: result.accepted, duplicate: result.duplicate },
  };
}

export const handleStripeDelivery = (
  connectorId: string,
  rawBody: string,
  signature: string | null,
) =>
  handleDelivery("stripe", connectorId, rawBody, {
    verified: (secret) => verifyStripeSignature(rawBody, signature, secret),
    normalize: (_, json) => normalizeStripeEvent(json),
  });

export const handlePolarDelivery = (
  connectorId: string,
  rawBody: string,
  headers: Parameters<typeof verifyPolarSignature>[1],
  products: string[] = [],
) =>
  handleDelivery("polar", connectorId, rawBody, {
    verified: (secret) => verifyPolarSignature(rawBody, headers, secret),
    normalize: async (projectId, json) => {
      const outcome = normalizePolarEvent(json, products);
      if (
        products.length &&
        outcome.kind === "event" &&
        outcome.event.parentSourceEventId
      ) {
        const held = await ledger.findExistingSourceIds(projectId, "polar", [
          outcome.event.parentSourceEventId,
        ]);
        if (!held.size) return { kind: "ignored", reason: "other product" };
      }
      return outcome;
    },
  });
