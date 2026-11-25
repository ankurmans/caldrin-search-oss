import { normalizeAndValidateStartUrl } from "@/server/lib/audit/url-policy";
import { publicFetch } from "@/server/lib/public-fetch";
import { ShopifyConnectionRepository } from "../repositories/ShopifyConnectionRepository";
import {
  StorePlatformRepository,
  type StorePlatform,
} from "../repositories/StorePlatformRepository";
import { findShopifyMarker, showsShopify } from "../rules/shopifyDetection";

const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
// The markers sit in the head and the first scripts; no need for the whole page.
const MAX_BYTES = 500_000;

type Project = { id: string; domain: string | null };
type Finding = Pick<StorePlatform, "detection" | "evidence">;

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  while (bytes < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return text;
}

/**
 * Reads the homepage once over public https, re-validating every redirect hop,
 * and looks for Shopify markers. A page that cannot be read concludes nothing.
 */
async function inspectHomepage(domain: string): Promise<Finding> {
  const unknown: Finding = { detection: "unknown", evidence: null };
  try {
    const host = new URL(domain.includes("://") ? domain : `https://${domain}`)
      .hostname;
    let url = `https://${host}/`;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      url = await normalizeAndValidateStartUrl(url);
      if (!url.startsWith("https://")) return unknown;
      const response = await publicFetch(url, {
        headers: { accept: "text/html", "user-agent": "Caldrin-Search/1.0" },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        url = new URL(location, url).toString();
        continue;
      }
      const html = await readCapped(response);
      const marker = findShopifyMarker(response.headers, html);
      if (marker) return { detection: "shopify", evidence: marker };
      return response.ok
        ? { detection: "not_shopify", evidence: null }
        : unknown;
    }
    return unknown;
  } catch {
    return unknown;
  }
}

async function check(project: Project): Promise<StorePlatform> {
  const domain = project.domain?.trim() ?? "";
  const finding = domain
    ? await inspectHomepage(domain)
    : ({ detection: "unknown", evidence: null } satisfies Finding);
  await StorePlatformRepository.saveDetection({
    projectId: project.id,
    checkedDomain: domain,
    checkedAt: new Date().toISOString(),
    ...finding,
  });
  const saved = await StorePlatformRepository.get(project.id);
  if (!saved) throw new Error("Failed to save the store platform check");
  return saved;
}

async function summarize(projectId: string, row: StorePlatform) {
  const connection = await ShopifyConnectionRepository.getConnection(projectId);
  return {
    connected: connection !== null,
    visible: showsShopify({
      connected: connection !== null,
      manualShopify: row.manualShopify,
      detection: row.detection,
    }),
    detection: row.detection,
    evidence: row.evidence,
    checkedAt: row.checkedAt,
    manualShopify: row.manualShopify,
    hasDomain: row.checkedDomain !== "",
  };
}

/** The first read checks the homepage; later reads use the saved result. */
async function getStatus(project: Project) {
  const saved = await StorePlatformRepository.get(project.id);
  const current = saved?.checkedDomain === (project.domain?.trim() ?? "");
  return summarize(project.id, saved && current ? saved : await check(project));
}

async function recheck(project: Project) {
  return summarize(project.id, await check(project));
}

async function setManualShopify(project: Project, manualShopify: boolean) {
  const saved =
    (await StorePlatformRepository.get(project.id)) ?? (await check(project));
  await StorePlatformRepository.setManualShopify(project.id, manualShopify);
  return summarize(project.id, { ...saved, manualShopify });
}

export const StorePlatformService = { getStatus, recheck, setManualShopify };
