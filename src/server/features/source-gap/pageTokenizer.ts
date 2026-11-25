import { Parser } from "htmlparser2";

const NON_CONTENT = new Set(["script", "style", "noscript", "svg", "template"]);
const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "caption",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);
const PARSE_TEXT_CAP = 120_000;
const MAX_LINKS = 200;
const MAX_INTERNAL_LINKS = 80;
const MAX_HEADINGS = 60;
const MAX_TABLES = 20;

export type RawTable = { headers: string[]; rows: number; cells: string[] };

export type RawPage = {
  title: string;
  meta: Map<string, string>;
  canonical: string | null;
  hreflang: string[];
  h1s: string[];
  h2s: string[];
  h3s: string[];
  tables: RawTable[];
  listCount: number;
  quoteCount: number;
  imageCount: number;
  internalLinkCount: number;
  internalLinks: string[];
  externalLinks: { url: string; anchor: string }[];
  times: string[];
  authorHints: string[];
  jsonLd: string[];
  text: string;
};

type OpenTable = RawTable & {
  cell: string | null;
  headerCell: boolean;
  inFirstRow: boolean;
};

type State = {
  raw: RawPage;
  host: string;
  finalUrl: string;
  inTitle: boolean;
  titleDone: boolean;
  svgDepth: number;
  heading: { level: number; text: string } | null;
  tableStack: OpenTable[];
  anchor: { href: string; text: string } | null;
  authorCapture: { depth: number; text: string } | null;
  jsonLdText: string | null;
  skip: number;
  depth: number;
};

export function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function openTable(): OpenTable {
  return {
    headers: [],
    rows: 0,
    cells: [],
    cell: null,
    headerCell: false,
    inFirstRow: true,
  };
}

function openTableTag(st: State, name: string) {
  if (name === "table") st.tableStack.push(openTable());
  const table = st.tableStack.at(-1);
  if (!table) return;
  if (name === "tr") {
    table.rows++;
    if (table.rows > 1) table.inFirstRow = false;
  }
  if (name === "th" || name === "td") {
    table.cell = "";
    table.headerCell = name === "th" || table.inFirstRow;
  }
}

function openHead(st: State, name: string, attrs: Record<string, string>) {
  if (name === "svg") st.svgDepth++;
  // Only the document's own <title> counts, not an icon's <title> inside an <svg>.
  if (name === "title" && !st.titleDone && st.svgDepth === 0) st.inTitle = true;
  if (name === "meta") {
    const key = (
      attrs.name ||
      attrs.property ||
      attrs.itemprop ||
      ""
    ).toLowerCase();
    if (key && attrs.content) st.raw.meta.set(key, attrs.content);
  }
  if (name !== "link") return;
  const rel = (attrs.rel ?? "").toLowerCase();
  if (rel === "canonical" && attrs.href) st.raw.canonical = attrs.href;
  if (rel === "alternate" && attrs.hreflang)
    st.raw.hreflang.push(attrs.hreflang);
}

function openContent(st: State, name: string, attrs: Record<string, string>) {
  const { raw } = st;
  if (BLOCK_TAGS.has(name) && raw.text.length < PARSE_TEXT_CAP)
    raw.text += "\n";
  if (/^h[1-3]$/.test(name)) st.heading = { level: Number(name[1]), text: "" };
  if (name === "ul" || name === "ol") raw.listCount++;
  if (name === "blockquote") raw.quoteCount++;
  if (name === "img") raw.imageCount++;
  if (name === "time" && attrs.datetime) raw.times.push(attrs.datetime);
  if (name === "a" && attrs.href) st.anchor = { href: attrs.href, text: "" };
  const classes = (attrs.class ?? "").toLowerCase();
  const byline =
    (attrs.rel ?? "").toLowerCase() === "author" ||
    /author|byline/.test(`${attrs.itemprop ?? ""} ${classes}`);
  if (!st.authorCapture && byline)
    st.authorCapture = { depth: st.depth, text: "" };
}

function handleOpen(st: State, name: string, attrs: Record<string, string>) {
  st.depth++;
  if (name === "script" && attrs.type === "application/ld+json")
    st.jsonLdText = "";
  if (NON_CONTENT.has(name)) st.skip++;
  openHead(st, name, attrs);
  if (st.skip > 0) return;
  openContent(st, name, attrs);
  openTableTag(st, name);
}

function handleText(st: State, data: string) {
  if (st.jsonLdText !== null) {
    st.jsonLdText += data;
    return;
  }
  if (st.inTitle) st.raw.title += data;
  if (st.skip > 0) return;
  if (st.raw.text.length < PARSE_TEXT_CAP) st.raw.text += data;
  if (st.heading) st.heading.text += data;
  const table = st.tableStack.at(-1);
  if (table && table.cell !== null) table.cell += data;
  if (st.anchor) st.anchor.text += data;
  if (st.authorCapture && st.authorCapture.text.length < 120)
    st.authorCapture.text += data;
}

function closeHeading(st: State, name: string) {
  const { heading } = st;
  if (!heading || name !== `h${heading.level}`) return;
  const value = clean(heading.text);
  const list =
    heading.level === 1
      ? st.raw.h1s
      : heading.level === 2
        ? st.raw.h2s
        : st.raw.h3s;
  if (value && list.length < MAX_HEADINGS) list.push(value);
  st.heading = null;
}

function closeTable(st: State, name: string) {
  const table = st.tableStack.at(-1);
  if (!table) return;
  if ((name === "th" || name === "td") && table.cell !== null) {
    const value = clean(table.cell);
    if (table.headerCell && table.headers.length < 12 && value)
      table.headers.push(value);
    else if (table.cells.length < 200) table.cells.push(value);
    table.cell = null;
  }
  if (name !== "table") return;
  st.tableStack.pop();
  if (st.raw.tables.length < MAX_TABLES)
    st.raw.tables.push({
      headers: table.headers.slice(0, 8),
      rows: table.rows,
      cells: table.cells,
    });
}

function closeAnchor(st: State) {
  const { anchor } = st;
  if (!anchor) return;
  st.anchor = null;
  let target: URL;
  try {
    target = new URL(anchor.href, st.finalUrl);
  } catch {
    return;
  }
  if (!/^https?:$/.test(target.protocol)) return;
  if (target.hostname.replace(/^www\./, "") === st.host) {
    st.raw.internalLinkCount++;
    target.hash = "";
    target.search = "";
    const href = target.toString();
    if (
      st.raw.internalLinks.length < MAX_INTERNAL_LINKS &&
      !st.raw.internalLinks.includes(href)
    )
      st.raw.internalLinks.push(href);
  } else if (st.raw.externalLinks.length < MAX_LINKS)
    st.raw.externalLinks.push({
      url: target.toString(),
      anchor: clean(anchor.text).slice(0, 120),
    });
}

function handleClose(st: State, name: string) {
  if (name === "script" && st.jsonLdText !== null) {
    st.raw.jsonLd.push(st.jsonLdText);
    st.jsonLdText = null;
  }
  if (NON_CONTENT.has(name) && st.skip > 0) st.skip--;
  if (name === "svg" && st.svgDepth > 0) st.svgDepth--;
  if (name === "title" && st.inTitle) {
    st.inTitle = false;
    st.titleDone = true;
  }
  if (st.skip === 0) {
    closeHeading(st, name);
    closeTable(st, name);
    if (name === "a") closeAnchor(st);
  }
  const capture = st.authorCapture;
  if (capture && st.depth <= capture.depth) {
    const value = clean(capture.text).replace(/^by\s+/i, "");
    if (value && value.length <= 80) st.raw.authorHints.push(value);
    st.authorCapture = null;
  }
  st.depth--;
}

/**
 * Reads a page's markup with a streaming tokenizer, so a large page never
 * becomes a DOM. Nothing is interpreted here; see pageFacts for that.
 */
export function tokenizePage(html: string, finalUrl: string): RawPage {
  let host = "";
  try {
    host = new URL(finalUrl).hostname.replace(/^www\./, "");
  } catch {
    // Links stay unclassified as internal.
  }
  const st: State = {
    raw: {
      title: "",
      meta: new Map(),
      canonical: null,
      hreflang: [],
      h1s: [],
      h2s: [],
      h3s: [],
      tables: [],
      listCount: 0,
      quoteCount: 0,
      imageCount: 0,
      internalLinkCount: 0,
      internalLinks: [],
      externalLinks: [],
      times: [],
      authorHints: [],
      jsonLd: [],
      text: "",
    },
    host,
    finalUrl,
    inTitle: false,
    titleDone: false,
    svgDepth: 0,
    heading: null,
    tableStack: [],
    anchor: null,
    authorCapture: null,
    jsonLdText: null,
    skip: 0,
    depth: 0,
  };
  const parser = new Parser(
    {
      onopentag: (name, attrs) => handleOpen(st, name, attrs),
      ontext: (data) => handleText(st, data),
      onclosetag: (name) => handleClose(st, name),
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return st.raw;
}
