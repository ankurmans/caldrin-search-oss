import { editorialVideoId, videoEmbedUrl } from "@/shared/editorialVideo";
import { ElementType, parseDocument } from "htmlparser2";

const ALLOWED = new Set([
  "p",
  "br",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "a",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "code",
  "blockquote",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "hr",
]);
const VOID = new Set(["br", "img", "hr"]);
const DROP = new Set([
  "script",
  "style",
  "object",
  "embed",
  "noscript",
  "template",
  "svg",
  "math",
]);

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function quoted(name: string, value: string) {
  return ` ${name}="${escapeHtml(value).replaceAll('"', "&quot;")}"`;
}

export function safeEditorialAddress(
  value: string,
  allowMail = false,
): boolean {
  const compact = value
    .split("")
    .filter((char) => char.charCodeAt(0) > 32)
    .join("");
  return (
    /^(?:https?:\/\/|\/(?![/\\])|#)/i.test(compact) ||
    (allowMail && /^mailto:/i.test(compact))
  );
}

type HtmlNode = ReturnType<typeof parseDocument>["children"][number];

type EditorialMedia = {
  links: ReadonlySet<string>;
  images: ReadonlySet<string>;
  videos: ReadonlySet<string>;
};

function clean(
  node: HtmlNode,
  depth: number,
  allowed?: EditorialMedia,
): string {
  if (depth > 100) return "";
  if (node.type === ElementType.Text) return escapeHtml(node.data);
  if (!("attribs" in node) || DROP.has(node.name)) return "";
  const { name, attribs } = node;
  if (name === "iframe") {
    const id = editorialVideoId(attribs.src ?? "");
    if (!id || (allowed && !allowed.videos.has(id))) return "";
    const title = attribs.title?.trim().slice(0, 160) || "YouTube video";
    return `<iframe${quoted("src", videoEmbedUrl(id))}${quoted("title", title)} width="640" height="360" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation" allowfullscreen></iframe>`;
  }
  const body = node.children
    .map((child) => clean(child, depth + 1, allowed))
    .join("");
  if (!ALLOWED.has(name)) return body;
  let attributes = "";
  if (name === "a") {
    const href = attribs.href?.trim() ?? "";
    if (
      !safeEditorialAddress(href, true) ||
      (allowed && !allowed.links.has(href))
    )
      return allowed ? body : `<a>${body}</a>`;
    attributes = quoted("href", href);
  }
  if (name === "img") {
    if (
      !safeEditorialAddress(attribs.src ?? "") ||
      (allowed && !allowed.images.has(attribs.src.trim()))
    )
      return "";
    attributes = quoted("src", attribs.src.trim());
    if (attribs.alt !== undefined) attributes += quoted("alt", attribs.alt);
  }
  const numbers =
    name === "ol"
      ? ["start"]
      : ["th", "td"].includes(name)
        ? ["colspan", "rowspan"]
        : [];
  for (const key of numbers) {
    if (/^[1-9][0-9]{0,2}$/.test(attribs[key] ?? ""))
      attributes += quoted(key, attribs[key]);
  }
  return VOID.has(name)
    ? `<${name}${attributes}>`
    : `<${name}${attributes}>${body}</${name}>`;
}

export function sanitizeHtml(html: string, allowed?: EditorialMedia): string {
  return parseDocument(html)
    .children.map((node) => clean(node, 0, allowed))
    .join("");
}
