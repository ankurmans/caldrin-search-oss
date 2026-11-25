import { sortBy } from "remeda";
import { AiCrawlerRepository as repo } from "../repositories/AiCrawlerRepository";
import { openSecret, sealSecret } from "@/server/lib/secret-box";
import { AI_BOT_USER_AGENT_TOKENS, detectAiBot } from "@/shared/ai-bots";

const API = "https://api.cloudflare.com/client/v4";
const DAY_MS = 24 * 60 * 60 * 1000;
export const FIRST_SYNC_DAYS = 30;
const REFRESH_DAYS = 3;
const MAX_PATHS_PER_DAY = 500;
const OTHER_PATHS = "(other paths)";
const PARALLEL_DAYS = 4;

// Only the requests that name an AI crawler, to the site's own host: a zone
// also carries subdomains (docs, an API) that are not the site being tracked.
const USER_AGENT_FILTER = AI_BOT_USER_AGENT_TOKENS.map(
  (token) => `{userAgent_like:"%${token}%"}`,
).join(",");
const queryFor = (hosts: string[]) =>
  `query($zone:String!,$start:Time!,$end:Time!){viewer{zones(filter:{zoneTag:$zone}){httpRequestsAdaptiveGroups(limit:5000,orderBy:[count_DESC],filter:{datetime_geq:$start,datetime_lt:$end,requestSource:"eyeball",AND:[{OR:[${USER_AGENT_FILTER}]},{OR:[${hosts.map((host) => `{clientRequestHTTPHost:"${host}"}`).join(",")}]}]}){count dimensions{userAgent clientRequestPath edgeResponseStatus}}}}}`;

/** The site's own host and its www form; null when the domain is not a plain hostname. */
function siteHosts(domain: string) {
  const bare = domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  return /^[a-z0-9.-]+$/.test(bare) ? [bare, `www.${bare}`] : null;
}

type Fail = { ok: false; reason: string };

async function cloudflare(token: string, path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body: unknown = await response.json().catch(() => null);
  return { status: response.status, body };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function cloudflareErrors(body: unknown): string {
  if (!isRecord(body) || !Array.isArray(body.errors)) return "";
  return body.errors
    .map((error) =>
      isRecord(error) && typeof error.message === "string" ? error.message : "",
    )
    .filter(Boolean)
    .join("; ")
    .slice(0, 200);
}

// The zone is the registered domain, which may be a parent of the site's host.
function zoneCandidates(domain: string) {
  const labels = domain.replace(/^www\./, "").split(".");
  return labels
    .slice(0, -1)
    .map((_, i) => labels.slice(i).join("."))
    .filter((name) => name.includes("."));
}

async function findZone(token: string, domain: string) {
  for (const name of zoneCandidates(domain)) {
    const { status, body } = await cloudflare(
      token,
      `/zones?name=${encodeURIComponent(name)}`,
    );
    if (status === 401 || status === 403) {
      return {
        ok: false,
        reason:
          "Cloudflare rejected this token. Create one with Zone > Zone > Read and Zone > Analytics > Read for your zone.",
      } satisfies Fail;
    }
    const first: unknown =
      isRecord(body) && Array.isArray(body.result) ? body.result[0] : null;
    if (isRecord(first) && typeof first.id === "string")
      return { ok: true, id: first.id, name };
  }
  return {
    ok: false,
    reason: `This token cannot see a Cloudflare zone for ${domain}. Make sure the token is allowed on that zone.`,
  } satisfies Fail;
}

type Group = {
  count: number;
  dimensions: {
    userAgent: string;
    clientRequestPath: string;
    edgeResponseStatus: number;
  };
};

async function fetchDay(
  token: string,
  zoneId: string,
  hosts: string[],
  day: string,
) {
  const start = Date.parse(`${day}T00:00:00Z`);
  const { status, body } = await cloudflare(token, "/graphql", {
    method: "POST",
    body: JSON.stringify({
      query: queryFor(hosts),
      variables: {
        zone: zoneId,
        start: new Date(start).toISOString(),
        end: new Date(start + DAY_MS).toISOString(),
      },
    }),
  });
  const data = isRecord(body) && isRecord(body.data) ? body.data : null;
  const viewer = data && isRecord(data.viewer) ? data.viewer : null;
  const zone =
    viewer && Array.isArray(viewer.zones) && isRecord(viewer.zones[0])
      ? viewer.zones[0]
      : null;
  const groups = zone?.httpRequestsAdaptiveGroups;
  if (!Array.isArray(groups)) {
    const detail = cloudflareErrors(body);
    throw new Error(
      detail || `Cloudflare analytics did not answer (status ${status}).`,
    );
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the query above selects exactly these fields
  return groups as Group[];
}

/** The path only: a query string can carry personal data and is never kept. */
const pathOf = (value: string) => {
  const path = value.split(/[?#]/)[0] ?? "";
  return (path.startsWith("/") ? path : `/${path}`).slice(0, 300);
};

type CountRow = {
  bot: string;
  path: string;
  statusClass: number;
  hits: number;
};

function countDay(groups: Group[]) {
  const rows = new Map<string, CountRow>();
  for (const group of groups) {
    const bot = detectAiBot(group.dimensions.userAgent);
    if (!bot) continue;
    const path = pathOf(group.dimensions.clientRequestPath);
    const statusClass = Math.floor(group.dimensions.edgeResponseStatus / 100);
    const id = `${bot}|${path}|${statusClass}`;
    const row = rows.get(id);
    if (row) row.hits += group.count;
    else rows.set(id, { bot, path, statusClass, hits: group.count });
  }
  const perPath = new Map<string, number>();
  for (const row of rows.values())
    perPath.set(row.path, (perPath.get(row.path) ?? 0) + row.hits);
  const kept = new Set(
    sortBy([...perPath], [([, hits]) => hits, "desc"])
      .slice(0, MAX_PATHS_PER_DAY)
      .map(([path]) => path),
  );
  // Paths past the cap fold into one row, so the totals stay whole.
  const merged = new Map<
    string,
    typeof rows extends Map<string, infer R> ? R : never
  >();
  for (const row of rows.values()) {
    const path = kept.has(row.path) ? row.path : OTHER_PATHS;
    const id = `${row.bot}|${path}|${row.statusClass}`;
    const existing = merged.get(id);
    if (existing) existing.hits += row.hits;
    else merged.set(id, { ...row, path });
  }
  return [...merged.values()];
}

const lastDays = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10),
  );

/**
 * Reads the last `days` days of AI crawler hits from Cloudflare and stores
 * them, replacing what was stored for those days. Never throws: a failure is
 * kept on the connection so the page can show it.
 */
export async function syncCloudflareCrawlerHits(
  projectId: string,
  days = REFRESH_DAYS,
) {
  const connection = await repo.getCloudflare(projectId);
  if (!connection) return { synced: false as const };
  const token = await openSecret(connection.sealedToken);
  const hosts = siteHosts((await repo.getProjectDomain(projectId)) ?? "");
  const finish = async (error: string | null) => {
    await repo.markCloudflareSync(projectId, {
      at: new Date().toISOString(),
      error,
    });
    return { synced: !error, error };
  };
  if (!token)
    return finish("The stored token could not be read. Connect again.");
  if (!hosts) return finish("This project's domain is not a plain hostname.");
  try {
    const list = lastDays(days);
    for (let i = 0; i < list.length; i += PARALLEL_DAYS) {
      await Promise.all(
        list.slice(i, i + PARALLEL_DAYS).map(async (day) => {
          const groups = await fetchDay(token, connection.zoneId, hosts, day);
          await repo.replaceDay(projectId, day, countDay(groups));
        }),
      );
    }
    return await finish(null);
  } catch (error) {
    return finish(
      error instanceof Error ? error.message.slice(0, 200) : "Sync failed.",
    );
  }
}

async function reusableToken(projectId: string, allowed: string[] | null) {
  const other = await repo.findWorkspaceCloudflare(projectId, allowed);
  return other ? openSecret(other.sealedToken) : null;
}

/** The zone whose token another project here can borrow, or null. */
export async function reusableCloudflareZone(
  projectId: string,
  allowed: string[] | null,
) {
  const other = await repo.findWorkspaceCloudflare(projectId, allowed);
  return other?.zoneName ?? null;
}

/**
 * Checks the token against the project's domain, keeps it sealed and reads
 * the first month. Returns the reason in words when it cannot connect, since
 * the browser only receives error codes from a thrown error.
 */
export async function connectCloudflare(
  projectId: string,
  pasted: string | undefined,
  allowedProjectIds: string[] | null,
) {
  // Without a pasted token, reuse the one another project in the workspace
  // already connected, so one token set up for several sites is entered once.
  const token = pasted?.trim()
    ? pasted.trim()
    : await reusableToken(projectId, allowedProjectIds);
  if (!token)
    return {
      connected: false as const,
      reason: "Paste a Cloudflare API token to connect.",
    };
  const domain = await repo.getProjectDomain(projectId);
  if (!domain)
    return { connected: false as const, reason: "This project has no domain." };
  const hosts = siteHosts(domain);
  if (!hosts)
    return {
      connected: false as const,
      reason: "This project's domain is not a plain hostname.",
    };
  const zone = await findZone(token, domain);
  if (!zone.ok) return { connected: false as const, reason: zone.reason };
  try {
    await fetchDay(token, zone.id, hosts, lastDays(1)[0] ?? "");
  } catch (error) {
    return {
      connected: false as const,
      reason: `Cloudflare would not share analytics for ${zone.name}: ${error instanceof Error ? error.message : "unknown error"}. The token needs Zone > Analytics > Read.`,
    };
  }
  await repo.saveCloudflare({
    projectId,
    sealedToken: await sealSecret(token),
    zoneId: zone.id,
    zoneName: zone.name,
    createdAt: new Date().toISOString(),
  });
  await syncCloudflareCrawlerHits(projectId, FIRST_SYNC_DAYS);
  return { connected: true as const, zoneName: zone.name };
}

export const disconnectCloudflare = (projectId: string) =>
  repo.deleteCloudflare(projectId);

/** Daily refresh for every connected project; one failing never stops the rest. */
export async function syncAllCloudflareCrawlerHits() {
  for (const projectId of await repo.listCloudflareProjectIds())
    await syncCloudflareCrawlerHits(projectId);
}
