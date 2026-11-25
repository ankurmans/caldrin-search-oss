import { sortBy } from "remeda";

type SamplePage = {
  relativePath: string | null;
  organicTraffic: number | null;
  keywords: number | null;
};

type PageFolder = { folder: string; pages: number; traffic: number };

const MAX_FOLDERS = 8;
const HOME = "(home page)";
const ROOT = "(root-level pages)";
const UNKNOWN = "(unknown URL)";

/**
 * `/blog/post?utm=1` to `/blog/`. Only the root path is the home page; a single
 * segment such as `/pricing` is a root-level page, and a missing or relative
 * URL is unknown rather than assumed to be the home page.
 */
function firstFolder(relativePath: string | null): string {
  if (!relativePath?.startsWith("/")) return UNKNOWN;
  const path = relativePath.split(/[?#]/)[0] ?? "";
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return HOME;
  return segments.length === 1 ? ROOT : `/${segments[0]}/`;
}

/**
 * Pages and estimated traffic by first URL folder, over a page sample. The
 * folder is read from the URL path only; it says nothing about page type.
 */
export function summarizePageFolders(pages: SamplePage[]): PageFolder[] {
  const byFolder = new Map<string, PageFolder>();
  for (const page of pages) {
    const folder = firstFolder(page.relativePath);
    const row = byFolder.get(folder) ?? { folder, pages: 0, traffic: 0 };
    row.pages += 1;
    row.traffic += page.organicTraffic ?? 0;
    byFolder.set(folder, row);
  }
  const sorted = sortBy([...byFolder.values()], [(row) => row.traffic, "desc"]);
  const head = sorted.slice(0, MAX_FOLDERS);
  const rest = sorted.slice(MAX_FOLDERS);
  return rest.length === 0
    ? head
    : [
        ...head,
        {
          folder: "Other folders",
          pages: rest.reduce((sum, row) => sum + row.pages, 0),
          traffic: rest.reduce((sum, row) => sum + row.traffic, 0),
        },
      ];
}
