import { Parser } from "htmlparser2";

export function withReportPrintBrand(
  html: string,
  brand: { name: string; accentColor: string | null; hideAttribution: boolean },
) {
  const name = brand.name
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const accent =
    brand.accentColor && /^#[0-9a-f]{6}$/i.test(brand.accentColor)
      ? brand.accentColor
      : "#374151";
  const attribution = brand.hideAttribution
    ? ""
    : '<span style="font-size:10pt;color:#475569">Made with Caldrin Search</span>';
  const masthead = `<div data-report-print-brand style="box-sizing:border-box;display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px;border-top:3pt solid ${accent};padding:9pt 0;margin:0 0 12pt;color:#111827;background:#fff;font:12pt system-ui,sans-serif;break-inside:avoid;break-after:avoid;print-color-adjust:exact"><strong>${name}</strong>${attribution}</div>`;

  let bodyStart: number | undefined;
  const parser = new Parser({
    onopentag(tag) {
      if (tag === "body" && bodyStart === undefined) {
        bodyStart = parser.endIndex + 1;
        parser.pause();
      }
    },
  });
  parser.end(html);
  // Older documents can omit the body tag. Append the masthead to their
  // implicit body without changing how the browser parses the existing head.
  const htmlEnd = html.toLowerCase().lastIndexOf("</html>");
  const offset = bodyStart ?? (htmlEnd === -1 ? html.length : htmlEnd);
  return html.slice(0, offset) + masthead + html.slice(offset);
}
