import { narrow, type MODEL_KEYS } from "@/shared/attribution/vocabulary";
import { AttributionLedgerRepository as ledger } from "../repositories/AttributionLedgerRepository";
import {
  getPublicKey,
  listAttributionKeys,
  rotateAttributionKey,
} from "./attributionKeys";
import { reprocessAttribution } from "./attributionReprocess";

const DEFAULT_SETTINGS = {
  consentMode: "required",
  timezone: "UTC",
  reportingCurrency: "USD",
  lookbackDays: 90,
  retentionDays: 395,
  defaultModel: "last_non_direct",
} as const;

const ownerOf = (row: { host: string }) => row.host;

/** Everything the setup page shows. Never a secret key. */
export async function getAttributionSetup(projectId: string) {
  const [settings, properties, brands, keys, publicKey, rules, pending] =
    await Promise.all([
      ledger.getSettings(projectId),
      ledger.listProperties(projectId),
      ledger.listBrands(projectId),
      listAttributionKeys(projectId),
      getPublicKey(projectId),
      ledger.listSourceRules(projectId),
      ledger.countPending(projectId),
    ]);
  return {
    settings: settings
      ? {
          consentMode:
            narrow(["required", "implied"], settings.consentMode) ?? "required",
          timezone: settings.timezone,
          reportingCurrency: settings.reportingCurrency,
          lookbackDays: settings.lookbackDays,
          retentionDays: settings.retentionDays,
          defaultModel: settings.defaultModel,
        }
      : { ...DEFAULT_SETTINGS },
    properties: properties.map((p) => ({
      id: p.id,
      name: p.name,
      host: ownerOf(p),
      brandId: p.brandId,
      verifiedAt: p.verifiedAt,
      lastEventAt: p.lastEventAt,
    })),
    brands: brands.map((b) => ({ id: b.id, name: b.name, slug: b.slug })),
    keys: keys.map((k) => ({
      kind: k.kind,
      prefix: k.prefix,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
    })),
    publicKey,
    sourceRules: rules.map((r) => ({
      id: r.id,
      matchKind: r.matchKind,
      pattern: r.pattern,
      channel: r.channel,
      sourceLabel: r.sourceLabel,
    })),
    pendingEvents: pending,
  };
}

type SettingsInput = {
  consentMode: "required" | "implied";
  timezone: string;
  reportingCurrency: string;
  lookbackDays: number;
  retentionDays: number;
  defaultModel: (typeof MODEL_KEYS)[number];
};

/**
 * Saves the project's attribution settings. A new lookback window changes
 * every credit, so it rebuilds the derived records from the ledger (events are
 * untouched) and the change is recorded as a model run.
 */
export async function saveAttributionSettings(
  projectId: string,
  input: SettingsInput,
  userId: string,
) {
  const before = await ledger.getSettings(projectId);
  if (!isValidTimezone(input.timezone)) throw new Error("Unknown time zone");
  await ledger.saveSettings({
    projectId,
    ...input,
    dailyEventLimit: before?.dailyEventLimit ?? 200000,
    updatedAt: new Date().toISOString(),
  });
  const lookbackChanged =
    (before?.lookbackDays ?? DEFAULT_SETTINGS.lookbackDays) !==
    input.lookbackDays;
  if (lookbackChanged)
    await reprocessAttribution(projectId, {
      reason: "lookback_changed",
      userId,
    });
  return { reprocessing: lookbackChanged };
}

function isValidTimezone(zone: string) {
  try {
    Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export async function addAttributionProperty(
  projectId: string,
  input: { name: string; host: string; brandId?: string },
) {
  const host = input.host.replace(/^www\./, "");
  if (await ledger.findPropertyByHost(projectId, host))
    return { added: false as const };
  await ledger.insertProperty({
    id: crypto.randomUUID(),
    projectId,
    brandId: input.brandId ?? null,
    name: input.name,
    host,
    createdAt: new Date().toISOString(),
  });
  // The first website gets the project's public key; later ones share it.
  if (!(await getPublicKey(projectId)))
    await rotateAttributionKey(projectId, "public");
  return { added: true as const };
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** A brand is an operating name inside one project, such as one of several companies under a parent. */
export async function addAttributionBrand(projectId: string, name: string) {
  const slug = slugify(name);
  if (!slug) throw new Error("Give the brand a name with letters or numbers");
  const brands = await ledger.listBrands(projectId);
  if (brands.some((b) => b.slug === slug || b.name === name))
    return { added: false as const };
  await ledger.insertBrand({
    id: crypto.randomUUID(),
    projectId,
    name,
    slug,
    createdAt: new Date().toISOString(),
  });
  return { added: true as const };
}

type RuleInput = {
  matchKind: "referrer_host" | "utm_source" | "utm_medium" | "click_id";
  pattern: string;
  channel: string;
  sourceLabel: string;
};

/**
 * A rule changes how history is read, so adding or removing one rebuilds the
 * derived records from the unchanged ledger.
 */
export async function addAttributionSourceRule(
  projectId: string,
  input: RuleInput,
  userId: string,
) {
  await ledger.insertSourceRule({
    id: crypto.randomUUID(),
    projectId,
    ...input,
    createdAt: new Date().toISOString(),
  });
  await reprocessAttribution(projectId, { reason: "rules_changed", userId });
}

export async function removeAttributionSourceRule(
  projectId: string,
  id: string,
  userId: string,
) {
  await ledger.deleteSourceRule(projectId, id);
  await reprocessAttribution(projectId, { reason: "rules_changed", userId });
}

export const removeAttributionProperty = (projectId: string, id: string) =>
  ledger.deleteProperty(projectId, id);

/**
 * Whether the tracker is installed and working: the newest events it sent,
 * whether a test event arrived, and whether real traffic has been seen.
 */
export async function getInstallStatus(projectId: string) {
  const events = await ledger.recentEvents(projectId, 40);
  const browser = events.filter((e) => e.origin === "browser");
  const testAt = browser.find((e) => e.isTest)?.ingestedAt ?? null;
  const real = browser.find((e) => !e.isTest && !e.isBot);
  return {
    receivedTestEvent: Boolean(testAt),
    lastTestAt: testAt,
    receivedRealTraffic: Boolean(real),
    lastRealAt: real?.ingestedAt ?? null,
    recent: events.slice(0, 10).map((e) => ({
      eventType: e.eventType,
      origin: e.origin,
      sourceSystem: e.sourceSystem,
      occurredAt: e.occurredAt,
      path: e.pagePath,
      isTest: e.isTest,
      isBot: e.isBot,
    })),
  };
}
