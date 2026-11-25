import { z } from "zod";
import { posthogCredentialsSchema } from "@/types/schemas/attribution";
import { openSecret, sealSecret } from "@/server/lib/secret-box";
import {
  hostMap,
  normalizePosthogRows,
  POSTHOG_SOURCE,
  posthogQuery,
} from "../adapters/posthog";
import { AttributionConnectorRepository as repo } from "../repositories/AttributionConnectorRepository";
import { AttributionLedgerRepository as ledger } from "../repositories/AttributionLedgerRepository";
import { ingestNormalized } from "./attributionIngest";

// Only PostHog's own cloud hosts are called, so a project cannot point this at
// an address inside a network.
const HOSTS = {
  us: "https://us.posthog.com",
  eu: "https://eu.posthog.com",
} as const;

const MAX_CONNECTORS = 5;
const MAX_RANGE_DAYS = 31;
const IMPORT_BUDGET = 5000;
const REQUEST_TIMEOUT_MS = 25_000;
const DAY_S = 86_400;

/** A message written for the person using the page, safe to show as it is. */
export class PosthogError extends Error {}

type Credentials = z.infer<typeof posthogCredentialsSchema>;

const responseSchema = z.object({ results: z.array(z.unknown()) });

/** Runs one HogQL query. The key is sent only to PostHog and never appears in an error. */
async function hogql(credentials: Credentials, query: string) {
  let response: Response;
  try {
    response = await fetch(
      `${HOSTS[credentials.region]}/api/projects/${credentials.posthogProjectId}/query/`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${credentials.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  } catch {
    throw new PosthogError(
      "PostHog did not answer in time. Try a shorter range.",
    );
  }
  if (response.status === 401)
    throw new PosthogError("PostHog rejected the API key.");
  if (response.status === 403)
    throw new PosthogError(
      "The API key needs the query:read scope for this project.",
    );
  if (response.status === 404)
    throw new PosthogError(
      "PostHog has no project with that id in this region.",
    );
  if (response.status === 429)
    throw new PosthogError(
      "PostHog is rate limiting queries. Try again in a minute.",
    );
  if (!response.ok)
    throw new PosthogError(`PostHog answered ${response.status}.`);
  const parsed = responseSchema.safeParse(await response.json());
  if (!parsed.success)
    throw new PosthogError("PostHog sent an answer in an unexpected shape.");
  return parsed.data.results;
}

const COUNT_QUERY = `SELECT event, count() FROM events
WHERE event IN ('$pageview', '$identify') AND timestamp > now() - INTERVAL 7 DAY
GROUP BY event`;

async function recentCounts(credentials: Credentials) {
  const counts = { pageViews: 0, identifies: 0 };
  for (const row of await hogql(credentials, COUNT_QUERY)) {
    if (!Array.isArray(row)) continue;
    if (row[0] === "$pageview") counts.pageViews = Number(row[1]) || 0;
    if (row[0] === "$identify") counts.identifies = Number(row[1]) || 0;
  }
  return counts;
}

/** The key another project in this workspace already connected, if any. */
async function workspaceCredentials(projectId: string) {
  const found = await repo.findWorkspaceConnector(projectId, POSTHOG_SOURCE);
  if (!found) return null;
  const plain = await openSecret(found.sealedSecret);
  const parsed = posthogCredentialsSchema.safeParse(
    plain ? JSON.parse(plain) : null,
  );
  return parsed.success
    ? { credentials: parsed.data, projectName: found.projectName }
    : null;
}

/** Says where a key could be reused from. The key itself is never returned. */
export async function reusablePosthogKey(projectId: string) {
  const found = await workspaceCredentials(projectId);
  return found
    ? { projectName: found.projectName, region: found.credentials.region }
    : null;
}

/**
 * Stores the connection only after PostHog accepts the key, and says what it
 * can see. Without a pasted key it reuses the one another project in the
 * workspace connected (with that key's region), so a personal key that covers
 * several PostHog projects is entered once.
 */
export async function createPosthogConnector(
  projectId: string,
  input: { label: string; posthogProjectId: string } & Partial<
    Pick<Credentials, "region" | "apiKey">
  >,
) {
  if ((await repo.list(projectId)).length >= MAX_CONNECTORS)
    throw new PosthogError(
      `A project can have up to ${MAX_CONNECTORS} connectors`,
    );
  const reused = input.apiKey ? null : await workspaceCredentials(projectId);
  if (!input.apiKey && !reused)
    throw new PosthogError("Paste a PostHog personal API key to connect.");
  const credentials = posthogCredentialsSchema.parse({
    region: reused?.credentials.region ?? input.region,
    posthogProjectId: input.posthogProjectId,
    apiKey: reused?.credentials.apiKey ?? input.apiKey,
  });
  const counts = await recentCounts(credentials);
  const id = crypto.randomUUID();
  await repo.insert({
    id,
    projectId,
    kind: POSTHOG_SOURCE,
    label: input.label,
    sealedSecret: await sealSecret(JSON.stringify(credentials)),
    createdAt: new Date().toISOString(),
  });
  return { id, ...counts };
}

async function openConnector(projectId: string, id: string) {
  const connector = await repo.get(id);
  if (
    !connector ||
    connector.projectId !== projectId ||
    connector.kind !== POSTHOG_SOURCE
  )
    throw new PosthogError("That PostHog connection was not found");
  const plain = await openSecret(connector.sealedSecret);
  const credentials = posthogCredentialsSchema.safeParse(
    plain ? JSON.parse(plain) : null,
  );
  if (!credentials.success) {
    await repo.recordFailure(
      connector.id,
      new Date().toISOString(),
      "credentials unreadable",
    );
    throw new PosthogError(
      "The stored PostHog credentials could not be read. Remove the connection and add it again.",
    );
  }
  return { connector, credentials: credentials.data };
}

/** A check with no import: whether PostHog still accepts the key and what it holds. */
export async function testPosthogConnector(projectId: string, id: string) {
  const { connector, credentials } = await openConnector(projectId, id);
  try {
    return await recentCounts(credentials);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "check failed";
    await repo.recordFailure(connector.id, new Date().toISOString(), reason);
    throw error;
  }
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Reads page views and identify calls for an explicit date range (inclusive,
 * UTC) and, unless it is a preview, writes them through the same ingestion as
 * every other source. Nothing runs on a schedule and nothing reaches back
 * further than the range asked for.
 */
export async function importPosthog(
  projectId: string,
  id: string,
  range: { from: string; to: string; dryRun: boolean },
) {
  const from = dateSchema.parse(range.from);
  const to = dateSchema.parse(range.to);
  const fromSeconds = Date.parse(`${from}T00:00:00Z`) / 1000;
  const toSeconds = Date.parse(`${to}T00:00:00Z`) / 1000 + DAY_S;
  if (
    !Number.isFinite(fromSeconds) ||
    !Number.isFinite(toSeconds) ||
    toSeconds <= fromSeconds
  )
    throw new PosthogError("Choose a start date on or before the end date");
  if ((toSeconds - fromSeconds) / DAY_S > MAX_RANGE_DAYS)
    throw new PosthogError(`Import at most ${MAX_RANGE_DAYS} days at a time`);
  if (fromSeconds > Date.now() / 1000)
    throw new PosthogError("The range starts in the future");

  const { connector, credentials } = await openConnector(projectId, id);
  const properties = await ledger.listProperties(projectId);
  if (properties.length === 0)
    throw new PosthogError(
      "Register a website first: only registered hosts are imported",
    );

  let rows: unknown[];
  try {
    rows = await hogql(
      credentials,
      posthogQuery(fromSeconds, toSeconds, IMPORT_BUDGET),
    );
  } catch (error) {
    await repo.recordFailure(
      connector.id,
      new Date().toISOString(),
      error instanceof Error ? error.message : "query failed",
    );
    throw error;
  }
  const truncated = rows.length > IMPORT_BUDGET;
  const { events, summary } = normalizePosthogRows(
    truncated ? rows.slice(0, IMPORT_BUDGET) : rows,
    hostMap(properties),
  );
  const held = await ledger.findExistingSourceIds(
    projectId,
    POSTHOG_SOURCE,
    events.map((e) => e.sourceEventId),
  );
  const preview = {
    from,
    to,
    truncated,
    budget: IMPORT_BUDGET,
    ...summary,
    wouldAdd: events.filter((e) => !held.has(e.sourceEventId)).length,
    alreadyHeld: events.filter((e) => held.has(e.sourceEventId)).length,
  };
  if (range.dryRun) return { ...preview, imported: null };

  const result = await ingestNormalized(
    projectId,
    { sourceSystem: POSTHOG_SOURCE, label: `PostHog ${from} to ${to}` },
    events,
  );
  const at = new Date().toISOString();
  await repo.recordEvent(connector.id, at);
  for (const propertyId of new Set(
    events.flatMap((e) => (e.propertyId ? [e.propertyId] : [])),
  ))
    await ledger.markPropertyEvent(propertyId, at, true);
  return {
    ...preview,
    imported: {
      accepted: result.accepted,
      duplicate: result.duplicate,
      rejected: result.rejected,
    },
  };
}
