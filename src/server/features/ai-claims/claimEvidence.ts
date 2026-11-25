import { parseDocument, DomUtils } from "htmlparser2";
import robotsParser from "robots-parser";
import { normalizeAndValidateStartUrl } from "@/server/lib/audit/url-policy";
import { publicFetch } from "@/server/lib/public-fetch";
import { readBoundedText } from "@/server/lib/scrape";
import { hashClaimInput } from "./claimRules";

const bot = "Caldrin-ClaimEvidence/1.0";

export function publicEvidenceUrl(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("Unsupported evidence URL");
  url.hash = "";
  return url.toString();
}

async function guardedGet(url: string, signal: AbortSignal) {
  const target = await normalizeAndValidateStartUrl(publicEvidenceUrl(url));
  return publicFetch(target, {
    redirect: "manual",
    signal,
    headers: { "user-agent": bot, accept: "text/html, text/plain" },
  });
}

async function robotsAllow(url: string, signal: AbortSignal) {
  const robotsUrl = new URL("/robots.txt", url).href;
  const response = await guardedGet(robotsUrl, signal);
  if (response.status === 404 || response.status === 410) {
    await response.body?.cancel();
    return true;
  }
  if (
    !response.ok ||
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("text/plain")
  ) {
    await response.body?.cancel();
    return false;
  }
  const text = await readBoundedText(response);
  return (
    text !== null && robotsParser(robotsUrl, text).isAllowed(url, bot) !== false
  );
}

export async function inspectPublicEvidence(url: string, passage: string) {
  const signal = AbortSignal.timeout(12_000);
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!(await robotsAllow(current, signal)))
      return { finalUrl: current, reason: "robots_unavailable_or_disallowed" };
    const response = await guardedGet(current, signal);
    const meta = { finalUrl: current, httpStatus: response.status };
    const redirected = [301, 302, 303, 307, 308].includes(response.status);
    if (redirected) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || hop === 3)
        return { ...meta, reason: "redirect_unavailable" };
      current = publicEvidenceUrl(new URL(location, current).href);
      continue;
    }
    const type = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (!response.ok || !["text/html", "text/plain"].includes(type ?? "")) {
      await response.body?.cancel();
      return { ...meta, reason: "page_unavailable" };
    }
    const raw = await readBoundedText(response);
    if (raw === null) return { ...meta, reason: "page_too_large" };
    if (
      type === "text/html" &&
      /"isAccessibleForFree"\s*:\s*(?:false|"false")/i.test(raw)
    )
      return { ...meta, reason: "access_restricted" };
    const document = type === "text/html" ? parseDocument(raw) : null;
    const nodes = document
      ? DomUtils.findAll(
          (tag) =>
            ["script", "style", "template", "noscript", "head"].includes(
              tag.name,
            ),
          document.children,
        )
      : [];
    const titleNode =
      document &&
      DomUtils.findAll((tag) => tag.name === "title", document.children)[0];
    const canonical =
      document &&
      DomUtils.findAll(
        (tag) => tag.name === "link" && tag.attribs.rel === "canonical",
        document.children,
      )[0]?.attribs.href;
    let canonicalUrl: string | null = null;
    if (canonical) {
      try {
        const target = publicEvidenceUrl(new URL(canonical, current).href);
        if (new URL(target).origin === new URL(current).origin)
          canonicalUrl = target;
      } catch {
        /* A malformed declaration is not canonical evidence. */
      }
    }
    const title = titleNode
      ? DomUtils.textContent(titleNode).trim().slice(0, 300)
      : null;
    for (const node of nodes) DomUtils.removeElement(node);
    const text = (document ? DomUtils.textContent(document) : raw)
      .replace(/\s+/g, " ")
      .trim();
    const offset = text.indexOf(passage);
    return {
      ...meta,
      canonicalUrl,
      title,
      contentHash: await hashClaimInput(text),
      matchingPassage: offset < 0 ? null : passage,
      excerpt:
        offset < 0
          ? null
          : text.slice(
              Math.max(0, offset - 120),
              offset + passage.length + 120,
            ),
      reason: offset < 0 ? "matching_passage_not_found" : null,
    };
  }
  return { reason: "redirect_unavailable" };
}
