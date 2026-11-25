import { queryOptions } from "@tanstack/react-query";
import {
  getSourceGap,
  getSourceGapTopics,
  listSourceGaps,
} from "@/serverFunctions/source-gap";

export const sourceGapKey = (projectId: string) => ["sourceGap", projectId];

export const sourceGapQueryOptions = (projectId: string, promptId: string) =>
  queryOptions({
    queryKey: [...sourceGapKey(projectId), "prompt", promptId],
    queryFn: () => getSourceGap({ data: { projectId, promptId } }),
  });

export const sourceGapSummariesQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: [...sourceGapKey(projectId), "summaries"],
    queryFn: () => listSourceGaps({ data: { projectId } }),
  });

export const sourceGapTopicsQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: [...sourceGapKey(projectId), "topics"],
    queryFn: () => getSourceGapTopics({ data: { projectId } }),
  });

export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

export function ageLabel(iso: string, now = Date.now()): string {
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (Number.isNaN(days)) return "unknown age";
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
