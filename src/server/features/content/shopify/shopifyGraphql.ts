import { z } from "zod";
import { ContentRefusal } from "../rules/contentRefusal";

// The one place that talks HTTP to the Shopify Admin GraphQL API. Throttling,
// pagination and error mapping live here once; liveShopify.ts only holds the
// documents and the mapping into the port.
//
// Confirmed against Shopify's Admin GraphQL rate-limit docs (calculated query
// cost): a throttled request answers HTTP 200 with an `errors[]` entry whose
// `extensions.code` is "THROTTLED", and every response may carry
// `extensions.cost.{requestedQueryCost, actualQueryCost, throttleStatus:
// {maximumAvailable, currentlyAvailable, restoreRate}}`. A throttled request
// was rejected before it ran, so retrying it cannot apply a write twice.
// HTTP 429 (+ Retry-After, seconds) is handled the same way.
//
// Tested only against a fake fetch; no real store has been called.

const SHOPIFY_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_MAX_WAIT_MS = 15_000;
const DEFAULT_MAX_PAGES = 50;
const BASE_BACKOFF_MS = 500;

// The request may or may not have reached Shopify (timeout, network error,
// 5xx on a write). The caller must not assume a write did or did not happen.
export class ShopifyOutcomeUnknown extends ContentRefusal {
  constructor(detail: string) {
    super(
      `Shopify did not confirm the request (${detail}). Check the store before retrying.`,
    );
    this.name = "ShopifyOutcomeUnknown";
  }
}

export type ShopifyClientConfig = {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
  // Injected by tests; production uses the global fetch and a real timer.
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  maxWaitMs?: number;
};

const costSchema = z.object({
  requestedQueryCost: z.number().optional(),
  throttleStatus: z
    .object({
      currentlyAvailable: z.number(),
      restoreRate: z.number(),
    })
    .optional(),
});

const envelope = z.object({
  data: z.unknown().optional(),
  errors: z
    .array(
      z.object({
        message: z.string(),
        extensions: z
          .object({ code: z.string().optional(), cost: costSchema.optional() })
          .loose()
          .optional(),
      }),
    )
    .optional(),
  extensions: z.object({ cost: costSchema.optional() }).loose().optional(),
});

export type PageInfo = { hasNextPage: boolean; endCursor: string | null };
export type Page<N> = { nodes: N[]; pageInfo: PageInfo };

export type ShopifyClient = {
  // `kind: "write"` is never retried after an unknown outcome (5xx, timeout).
  query(
    document: string,
    variables?: Record<string, unknown>,
    kind?: "read" | "write",
  ): Promise<unknown>;
  // Follows `pageInfo.endCursor` until the connection is exhausted. The
  // document must declare `$after: String` and pass it to the connection.
  readAll<N>(
    document: string,
    parsePage: (data: unknown) => Page<N>,
    options?: { maxPages?: number },
  ): Promise<{ nodes: N[]; truncated: boolean }>;
};

function backoffMs(attempt: number): number {
  return BASE_BACKOFF_MS * 2 ** attempt;
}

// Time for the cost bucket to refill enough for the request that was refused.
function throttleWaitMs(
  cost: z.infer<typeof costSchema> | undefined,
  attempt: number,
): number {
  const status = cost?.throttleStatus;
  const requested = cost?.requestedQueryCost;
  if (status && requested !== undefined && status.restoreRate > 0) {
    const missing = Math.max(0, requested - status.currentlyAvailable);
    return Math.max(
      BASE_BACKOFF_MS,
      Math.ceil((missing / status.restoreRate) * 1000),
    );
  }
  return backoffMs(attempt);
}

function retryAfterMs(header: string | null, attempt: number): number {
  const seconds = header === null ? NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.max(BASE_BACKOFF_MS, Math.ceil(seconds * 1000))
    : backoffMs(attempt);
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createShopifyClient(
  config: ShopifyClientConfig,
): ShopifyClient {
  const doFetch = config.fetchImpl ?? fetch;
  const sleep = config.sleep ?? defaultSleep;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxWaitMs = config.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const url = `https://${config.shopDomain}/admin/api/${config.apiVersion}/graphql.json`;

  // Returns the wait before the next attempt, or throws when out of retries or
  // when the wait is longer than this request is allowed to sleep.
  async function waitOrGiveUp(
    attempt: number,
    waitMs: number,
    what: string,
  ): Promise<void> {
    if (attempt >= maxRetries || waitMs > maxWaitMs) {
      throw new ContentRefusal(
        `Shopify is rate limiting this store (${what}). Try again shortly.`,
      );
    }
    await sleep(waitMs);
  }

  async function query(
    document: string,
    variables: Record<string, unknown> = {},
    kind: "read" | "write" = "read",
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await doFetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-shopify-access-token": config.accessToken,
          },
          body: JSON.stringify({ query: document, variables }),
          signal: AbortSignal.timeout(SHOPIFY_TIMEOUT_MS),
        });
      } catch (error) {
        // Never echo the error object: it is not ours to promise it holds no
        // request headers.
        const detail =
          error instanceof Error && error.name === "TimeoutError"
            ? "timed out"
            : "network error";
        if (kind === "write") throw new ShopifyOutcomeUnknown(detail);
        if (attempt >= maxRetries) {
          throw new ContentRefusal(`Shopify could not be reached (${detail}).`);
        }
        await sleep(backoffMs(attempt));
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw new ContentRefusal(
          "Shopify rejected the stored credentials. Reconnect the store.",
        );
      }
      if (response.status === 429) {
        await waitOrGiveUp(
          attempt,
          retryAfterMs(response.headers.get("retry-after"), attempt),
          "HTTP 429",
        );
        continue;
      }
      if (response.status >= 500) {
        if (kind === "write") {
          throw new ShopifyOutcomeUnknown(`HTTP ${response.status}`);
        }
        if (attempt >= maxRetries) {
          throw new ContentRefusal(`Shopify returned ${response.status}.`);
        }
        await sleep(backoffMs(attempt));
        continue;
      }
      if (!response.ok) {
        throw new ContentRefusal(`Shopify returned ${response.status}.`);
      }

      const parsed = envelope.safeParse(await response.json());
      if (!parsed.success) {
        throw new ContentRefusal(
          "Shopify returned a response in an unexpected shape.",
        );
      }
      const errors = parsed.data.errors ?? [];
      const throttled = errors.find((e) => e.extensions?.code === "THROTTLED");
      if (throttled) {
        const cost = throttled.extensions?.cost ?? parsed.data.extensions?.cost;
        await waitOrGiveUp(attempt, throttleWaitMs(cost, attempt), "THROTTLED");
        continue;
      }
      if (errors.length > 0) {
        throw new ContentRefusal(
          `Shopify error: ${errors
            .map((e) => e.message)
            .join("; ")
            .slice(0, 300)}`,
        );
      }
      return parsed.data.data;
    }
  }

  async function readAll<N>(
    document: string,
    parsePage: (data: unknown) => Page<N>,
    options: { maxPages?: number } = {},
  ): Promise<{ nodes: N[]; truncated: boolean }> {
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    const nodes: N[] = [];
    let after: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      const current: Page<N> = parsePage(await query(document, { after }));
      nodes.push(...current.nodes);
      const next = current.pageInfo.endCursor;
      if (!current.pageInfo.hasNextPage || !next) {
        return { nodes, truncated: false };
      }
      // A cursor that does not advance would loop forever: stop and say the
      // list may be incomplete.
      if (next === after) return { nodes, truncated: true };
      after = next;
    }
    return { nodes, truncated: true };
  }

  return { query, readAll };
}
