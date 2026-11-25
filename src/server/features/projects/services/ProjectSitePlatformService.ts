import type { EnsuredProject } from "@/middleware/ensure-user/types";
import { readTextUpTo } from "@/server/lib/audit/html-response";
import {
  isCrawlableUrl,
  normalizeAndValidateStartUrl,
} from "@/server/lib/audit/url-policy";
import { runAfterResponse } from "@/server/lib/background";
import { AppError } from "@/server/lib/errors";
import { publicFetch } from "@/server/lib/public-fetch";
import { proxiedByCloudflare } from "@/server/lib/site-host-dns";
import { detectSiteHost, detectSitePlatform } from "@/shared/site-host";
import type { SitePlatform } from "@/shared/site-platform";
import { ProjectRepository } from "../repositories/ProjectRepository";

const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 512_000;

async function hasWordPressRestApi(origin: string, signal: AbortSignal) {
  try {
    const response = await publicFetch(new URL("/wp-json/", origin), {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal,
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("json")
    ) {
      await response.body?.cancel();
      return false;
    }
    const content = await readTextUpTo(response, 16_000);
    // The API index can be large. Its namespace list comes before its routes.
    return /"namespaces"\s*:\s*\[[^\]]*"wp\/v2"/.test(content);
  } catch {
    return false;
  }
}

async function readHomepage(domain: string, signal: AbortSignal) {
  let url = await normalizeAndValidateStartUrl(`https://${domain}/`);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (signal.aborted) break;
    const response = await publicFetch(url, {
      headers: { accept: "text/html", "user-agent": "Caldrin-Search/1.0" },
      redirect: "manual",
      signal,
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      const next = new URL(location, url);
      if (
        !isCrawlableUrl(next.href) ||
        next.username ||
        next.password ||
        next.port
      )
        break;
      url = await normalizeAndValidateStartUrl(next.href);
      continue;
    }

    const headers = response.headers;
    if (
      detectSitePlatform(headers).declared ||
      !response.ok ||
      !headers.get("content-type")?.includes("text/html")
    ) {
      await response.body?.cancel();
      return { url, headers, html: "", ok: response.ok };
    }
    return {
      url,
      headers,
      html: await readTextUpTo(response, MAX_HTML_BYTES).catch(() => ""),
      ok: true,
    };
  }
  return null;
}

async function detect(project: EnsuredProject) {
  if (!project.domain)
    throw new AppError("VALIDATION_ERROR", "Add a website first.");

  const signal = AbortSignal.timeout(7_000);
  const [homepage, proxied] = await Promise.all([
    readHomepage(project.domain, signal).catch(() => null),
    proxiedByCloudflare(project.domain),
  ]);
  const headers = homepage?.headers ?? new Headers();
  const { declared, markup, framework } = detectSitePlatform(
    headers,
    homepage?.html,
  );
  const wordpressRest =
    !declared &&
    homepage?.ok &&
    (await hasWordPressRestApi(homepage.url, signal));
  const match =
    declared ??
    (wordpressRest
      ? {
          platform: "wordpress" as const,
          evidence: "WordPress REST API at /wp-json/",
        }
      : (markup ?? framework));

  return ProjectRepository.updateSitePlatform(
    project.id,
    project.organizationId,
    project.domain,
    {
      siteHost: detectSiteHost(headers, proxied),
      detectedPlatform: match?.platform ?? "unknown",
      platformEvidence: match?.evidence ?? null,
    },
  );
}

async function detectInBackground(project: EnsuredProject) {
  if (!project.domain || project.detectedPlatform) return;
  await runAfterResponse(
    detect(project).catch(() =>
      console.warn(
        "[project-platform] Detection could not be saved",
        project.id,
      ),
    ),
  );
}

async function setOverride(
  project: EnsuredProject,
  domain: string,
  platform: SitePlatform | null,
) {
  return ProjectRepository.updateSitePlatform(
    project.id,
    project.organizationId,
    domain,
    {
      platformOverride: platform,
    },
  );
}

export const ProjectSitePlatformService = {
  detect,
  detectInBackground,
  setOverride,
};
