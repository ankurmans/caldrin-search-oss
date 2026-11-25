import {
  escapeHtml,
  sanitizeHtml,
} from "@/server/features/content/rules/sanitizeHtml";
import type { Fields } from "./useWorkingDraft";

export function downloadDraft(fields: Fields) {
  const description = escapeHtml(fields.metaDescription).replaceAll(
    '"',
    "&quot;",
  );
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="frame-src https://www.youtube-nocookie.com"><title>${escapeHtml(fields.metaTitle)}</title><meta name="description" content="${description}"><style>article{max-width:75ch;margin:2rem auto;padding:0 1rem;line-height:1.6}img,iframe{max-width:100%}img{height:auto}iframe{width:100%;height:auto;aspect-ratio:16/9;border:0}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.5rem;text-align:left}</style><article><h1>${escapeHtml(fields.title)}</h1>${sanitizeHtml(fields.bodyHtml)}</article></html>`;
  const url = URL.createObjectURL(
    new Blob([html], { type: "text/html;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "draft.html";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
