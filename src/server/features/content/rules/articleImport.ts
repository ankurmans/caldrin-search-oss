import { ElementType, parseDocument } from "htmlparser2";
import { editorialVideoId } from "@/shared/editorialVideo";
import { sanitizeHtml } from "./sanitizeHtml";

type PageNode = ReturnType<typeof parseDocument>["children"][number];

function find(
  nodes: PageNode[],
  name: string,
  depth = 0,
): Extract<PageNode, { attribs: object }> | undefined {
  if (depth > 100) return;
  for (const node of nodes) {
    if ("attribs" in node && node.name === name) return node;
    if ("children" in node) {
      const match = find(node.children, name, depth + 1);
      if (match) return match;
    }
  }
}

function text(node: PageNode, depth = 0): string {
  if (depth > 100) return "";
  if (node.type === ElementType.Text) return node.data;
  return "children" in node
    ? node.children.map((child) => text(child, depth + 1)).join("")
    : "";
}

const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const OMIT = new Set([
  "script",
  "style",
  "nav",
  "footer",
  "aside",
  "form",
  "noscript",
  "svg",
  "template",
  "head",
]);
const VOID = new Set(["br", "img", "hr"]);

export function importArticle(html: string, url: string) {
  const doc = parseDocument(html);
  const article =
    find(doc.children, "article") ??
    find(doc.children, "main") ??
    find(doc.children, "body");
  const heading =
    find(article?.children ?? [], "h1") ?? find(doc.children, "title");
  let formattingWarning = false;
  function toHtml(node: PageNode, depth = 0): string {
    if (depth > 100) return "";
    if (node === heading && "attribs" in node && node.name === "h1") return "";
    if (node.type === ElementType.Text) return escape(node.data);
    if (!("attribs" in node)) return "";
    if (OMIT.has(node.name)) return "";
    if (
      [
        "video",
        "audio",
        "picture",
        "figure",
        "pre",
        "details",
        "canvas",
      ].includes(node.name) ||
      (node.name === "iframe" && !editorialVideoId(node.attribs.src ?? "")) ||
      node.attribs.style
    )
      formattingWarning = true;
    const name = node.name === "h1" ? "h2" : node.name;
    const attrs = [
      "href",
      "src",
      "alt",
      "title",
      "colspan",
      "rowspan",
      "start",
    ].flatMap((key) => {
      const value = node.attribs[key];
      if (value === undefined) return [];
      if (key === "src" || key === "href") {
        try {
          return [` ${key}="${escape(new URL(value, url).href)}"`];
        } catch {
          return [];
        }
      }
      return [` ${key}="${escape(value)}"`];
    });
    return `<${name}${attrs.join("")}>${VOID.has(name) ? "" : `${node.children.map((child) => toHtml(child, depth + 1)).join("")}</${name}>`}`;
  }
  const bodyHtml = sanitizeHtml(
    (article?.children ?? []).map((child) => toHtml(child)).join(""),
  ).trim();
  return {
    title: heading ? text(heading).trim().slice(0, 200) : "",
    bodyHtml,
    formattingWarning,
  };
}
