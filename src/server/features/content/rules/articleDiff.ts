import type { ArticleFields } from "../shopify/ShopifyStorePort";

// Pure text rendering and diffing of an article, so a person sees exactly what
// will change before anything is written, and the ledger freezes the same text.

export type ArticleState = ArticleFields & { isPublished?: boolean };

export type FieldChange = {
  field: "title" | "metaTitle" | "metaDescription" | "bodyHtml" | "isPublished";
  label: string;
};

export type ArticleDiff = {
  unchanged: boolean;
  changes: FieldChange[];
  // Body lines only; the other fields are whole-value changes.
  linesAdded: number;
  linesRemoved: number;
  // Readable: "- " removed, "+ " added, "  " context, "..." elided.
  text: string;
};

const LABELS = {
  title: "Title",
  metaTitle: "SEO title",
  metaDescription: "SEO description",
  bodyHtml: "Body",
  isPublished: "Status",
} as const;

const CONTEXT_LINES = 2;
// LCS table size cap. Past it, the body is reported as replaced wholesale
// rather than spending unbounded CPU in a request.
const MAX_LCS_CELLS = 4_000_000;

const statusLabel = (isPublished: boolean) =>
  isPublished ? "published" : "draft (not public)";

// One element per line so the diff is readable and stable.
function bodyLines(html: string): string[] {
  return html
    .replace(
      /(<\/(p|h[1-6]|li|ul|ol|div|blockquote|table|tr|section)>)/gi,
      "$1\n",
    )
    .replace(/(<br\s*\/?>)/gi, "$1\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// The frozen text the ledger stores as before/after. Deterministic: equal
// content always renders to equal text, which is what lets the executor
// detect that the live article drifted since the change was proposed.
export function renderArticleState(
  state: ArticleState,
  articleId?: string,
): string {
  return [
    articleId ? `Article: ${articleId}` : null,
    `Title: ${state.title}`,
    `SEO title: ${state.metaTitle}`,
    `SEO description: ${state.metaDescription}`,
    state.isPublished === undefined
      ? null
      : `Status: ${statusLabel(state.isPublished)}`,
    "Body:",
    ...bodyLines(state.bodyHtml),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

type Op = { kind: " " | "-" | "+"; line: string };

function lineOps(before: string[], after: string[]): Op[] | null {
  const n = before.length;
  const m = after.length;
  if ((n + 1) * (m + 1) > MAX_LCS_CELLS) return null;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        before[i] === after[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(
              table[(i + 1) * width + j] ?? 0,
              table[i * width + j + 1] ?? 0,
            );
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ kind: " ", line: before[i] ?? "" });
      i++;
      j++;
    } else if (
      (table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)
    ) {
      ops.push({ kind: "-", line: before[i] ?? "" });
      i++;
    } else {
      ops.push({ kind: "+", line: after[j] ?? "" });
      j++;
    }
  }
  for (; i < n; i++) ops.push({ kind: "-", line: before[i] ?? "" });
  for (; j < m; j++) ops.push({ kind: "+", line: after[j] ?? "" });
  return ops;
}

// Keeps changed lines and CONTEXT_LINES around them; elides the rest.
function renderOps(ops: Op[]): string[] {
  const keep = ops.map((op) => op.kind !== " ");
  const visible = ops.map((_, index) => {
    for (
      let k = Math.max(0, index - CONTEXT_LINES);
      k <= Math.min(ops.length - 1, index + CONTEXT_LINES);
      k++
    ) {
      if (keep[k]) return true;
    }
    return false;
  });
  const out: string[] = [];
  let elided = false;
  ops.forEach((op, index) => {
    if (visible[index]) {
      out.push(`${op.kind} ${op.line}`);
      elided = false;
    } else if (!elided) {
      out.push("...");
      elided = true;
    }
  });
  return out;
}

// `before` null means a new article: everything is an addition.
export function diffArticles(
  before: ArticleState | null,
  after: ArticleState,
): ArticleDiff {
  const changes: FieldChange[] = [];
  const out: string[] = [];

  for (const field of ["title", "metaTitle", "metaDescription"] as const) {
    const was = before?.[field] ?? null;
    if (was === after[field]) continue;
    changes.push({ field, label: LABELS[field] });
    if (was !== null) out.push(`- ${LABELS[field]}: ${was}`);
    out.push(`+ ${LABELS[field]}: ${after[field]}`);
  }

  const wasPublished = before?.isPublished;
  if (after.isPublished !== undefined && wasPublished !== after.isPublished) {
    changes.push({ field: "isPublished", label: LABELS.isPublished });
    if (wasPublished !== undefined) {
      out.push(`- Status: ${statusLabel(wasPublished)}`);
    }
    out.push(`+ Status: ${statusLabel(after.isPublished)}`);
  }

  let linesAdded = 0;
  let linesRemoved = 0;
  const beforeLines = before ? bodyLines(before.bodyHtml) : [];
  const afterLines = bodyLines(after.bodyHtml);
  if (before === null || before.bodyHtml !== after.bodyHtml) {
    const ops = lineOps(beforeLines, afterLines);
    if (ops === null) {
      linesRemoved = beforeLines.length;
      linesAdded = afterLines.length;
      out.push(
        `Body replaced: ${linesRemoved} lines removed, ${linesAdded} lines added (too large to compare line by line).`,
      );
    } else {
      linesAdded = ops.filter((op) => op.kind === "+").length;
      linesRemoved = ops.filter((op) => op.kind === "-").length;
      if (linesAdded + linesRemoved > 0) {
        out.push("Body:", ...renderOps(ops));
      }
    }
    if (linesAdded + linesRemoved > 0) {
      changes.push({ field: "bodyHtml", label: LABELS.bodyHtml });
    }
  }

  return {
    unchanged: changes.length === 0,
    changes,
    linesAdded,
    linesRemoved,
    text: changes.length === 0 ? "No changes." : out.join("\n"),
  };
}
