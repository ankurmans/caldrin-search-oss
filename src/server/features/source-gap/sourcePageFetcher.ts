import { readTextUpTo } from "@/server/lib/audit/html-response";
import { hostedOrigin } from "@/shared/hosted-origin";
import robotsParser from "robots-parser";
import { classifyFetch } from "@/server/lib/audit/classify-fetch";
import { normalizeAndValidateStartUrl } from "@/server/lib/audit/url-policy";
import { publicFetch } from "@/server/lib/public-fetch";
import { readBoundedText } from "@/server/lib/scrape";
import type { SnapshotFetchStatus } from "@/shared/source-gap";
import { isFileUrl, isHomepageUrl } from "./sourceUrl";

const SOURCE_GAP_USER_AGENT = `Caldrin-SourceGap/1.0${hostedOrigin ? ` (+${hostedOrigin})` : ""}`;
const ROBOTS_TOKEN = "Caldrin-SourceGap";
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 4;
const MAX_ROBOTS_BYTES = 200_000;

export interface FetchedPage {
  status: SnapshotFetchStatus;
  httpStatus: number | null;
  html: string | null;
  finalUrl: string;
  note: string | null;
}

export interface FetchDeps {
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  validate?: (url: string) => Promise<string>;
  robots?: RobotsGate;
  /** Link checks read front pages and files-as-pages too; source analysis does not. */
  allowHomepage?: boolean;
}

export interface RobotsGate {
  allowed(url: string): Promise<boolean>;
}

/**
 * robots.txt for each origin, read once per analysis. A missing or unreadable
 * robots.txt allows the fetch, as crawlers conventionally do.
 */
export function createRobotsGate(deps: FetchDeps = {}): RobotsGate {
  const fetchImpl = deps.fetchImpl ?? publicFetch;
  const byOrigin = new Map<
    string,
    Promise<ReturnType<typeof robotsParser> | null>
  >();
  const load = async (origin: string) => {
    try {
      const response = await fetchImpl(`${origin}/robots.txt`, {
        headers: { "user-agent": SOURCE_GAP_USER_AGENT },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const body = await readTextUpTo(response, MAX_ROBOTS_BYTES);
      return robotsParser(`${origin}/robots.txt`, body);
    } catch {
      return null;
    }
  };
  return {
    async allowed(url) {
      let origin: string;
      try {
        origin = new URL(url).origin;
      } catch {
        return false;
      }
      let entry = byOrigin.get(origin);
      if (!entry) {
        entry = load(origin);
        byOrigin.set(origin, entry);
      }
      const robots = await entry;
      return robots?.isAllowed(url, ROBOTS_TOKEN) ?? true;
    },
  };
}

function failure(
  status: SnapshotFetchStatus,
  finalUrl: string,
  note: string,
  httpStatus: number | null = null,
): FetchedPage {
  return { status, httpStatus, html: null, finalUrl, note };
}

/**
 * Reads one public page with a plain request. Every hop is re-validated
 * against the SSRF guard and robots.txt. A page that cannot be read comes back
 * as a status and a note, never as an exception, so one dead source does not
 * stop an analysis. Nothing is rendered or billed here: a bot challenge is
 * recorded as one.
 */
export async function fetchSourcePage(
  url: string,
  deps: FetchDeps = {},
): Promise<FetchedPage> {
  const fetchImpl = deps.fetchImpl ?? publicFetch;
  const validate = deps.validate ?? normalizeAndValidateStartUrl;
  const robots = deps.robots ?? createRobotsGate(deps);
  if (isFileUrl(url))
    return failure("not_html", url, "The source is a file, not a web page.");
  if (!deps.allowHomepage && isHomepageUrl(url))
    return failure(
      "homepage_only",
      url,
      "The answer cited the site's front page, so there is no page-level source to compare.",
    );
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      try {
        current = await validate(current);
      } catch {
        return failure(
          "unreachable",
          current,
          "The address is not a public web page.",
        );
      }
      if (!(await robots.allowed(current)))
        return failure(
          "blocked_by_robots",
          current,
          "The site's robots.txt does not allow this fetch.",
        );
      const response = await fetchImpl(current, {
        headers: {
          "user-agent": SOURCE_GAP_USER_AGENT,
          accept: "text/html,application/xhtml+xml",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        current = new URL(location, current).toString();
        continue;
      }
      const httpStatus = response.status;
      if (response.status === 404 || response.status === 410) {
        await response.body?.cancel();
        return failure(
          "not_found",
          current,
          "The page no longer exists.",
          httpStatus,
        );
      }
      const type = response.headers.get("content-type") ?? "";
      const body =
        response.ok && /html|xml/i.test(type || "html")
          ? await readBoundedText(response)
          : (await response.body?.cancel(), null);
      const mitigated = response.headers.has("cf-mitigated");
      const klass = classifyFetch(
        httpStatus,
        mitigated,
        (body ?? "").slice(0, 2000),
      );
      if (klass !== "ok" || httpStatus === 429)
        return failure(
          "challenge",
          current,
          "The site answered with a bot challenge or rate limit; the page was not rendered.",
          httpStatus,
        );
      if (!response.ok)
        return failure(
          "http_error",
          current,
          `The site answered HTTP ${httpStatus}.`,
          httpStatus,
        );
      if (response.ok && type && !/html|xml/i.test(type))
        return failure(
          "not_html",
          current,
          "The source is not an HTML page.",
          httpStatus,
        );
      if (body === null)
        return failure(
          "unreachable",
          current,
          "The page was too large to read.",
          httpStatus,
        );
      return {
        status: "ok",
        httpStatus,
        html: body,
        finalUrl: current,
        note: null,
      };
    }
    return failure("unreachable", current, "Too many redirects.");
  } catch {
    return failure("unreachable", current, "The site could not be reached.");
  }
}
