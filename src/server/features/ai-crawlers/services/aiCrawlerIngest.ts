import { AiCrawlerRepository as repo } from "../repositories/AiCrawlerRepository";
import { hashCrawlerKey } from "./aiCrawlerKeys";
import { detectAiBot } from "@/shared/ai-bots";
import { parseCrawlerLog } from "@/shared/ai-crawler-logs";
import type { CrawlerEvent } from "@/types/schemas/ai-crawlers";

/** Distinct paths kept per project and day; the rest count under one row. */
const MAX_PATHS_PER_DAY = 500;
const OTHER_PATHS = "(other paths)";
const LAST_USED_REFRESH_MS = 10 * 60 * 1000;

/** The path only: a query string can carry personal data and is never kept. */
function pathOf(value: string) {
  const path = value.split(/[?#]/)[0] ?? "";
  return (path.startsWith("/") ? path : `/${path}`).slice(0, 300);
}

/**
 * Counts one visit sent by a customer's snippet. Returns null for an unknown
 * key, and whether the visit was counted: a user agent that claims no AI
 * crawler is dropped.
 */
export async function recordCrawlerHit(key: string, event: CrawlerEvent) {
  const owner = await repo.findKey(await hashCrawlerKey(key));
  if (!owner) return null;
  const now = new Date();
  const bot = detectAiBot(event.userAgent);
  if (!bot) return { recorded: false };
  const day = now.toISOString().slice(0, 10);
  let path = pathOf(event.path);
  if (
    !(await repo.hasPath(owner.projectId, day, path)) &&
    (await repo.countPaths(owner.projectId, day)) >= MAX_PATHS_PER_DAY
  )
    path = OTHER_PATHS;
  await repo.addHits({
    projectId: owner.projectId,
    day,
    bot,
    path,
    statusClass: Math.floor(event.status / 100),
  });
  if (
    !owner.lastUsedAt ||
    now.getTime() - Date.parse(owner.lastUsedAt) > LAST_USED_REFRESH_MS
  )
    await repo.touchKey(owner.id, now.toISOString());
  return { recorded: true };
}

/**
 * Counts the AI crawler visits in an access log or log-drain body. Each visit
 * counts on the day the log gives it. A log sent twice counts twice, so send
 * each file once; nothing here can tell a repeated line from a repeated visit.
 */
export async function recordCrawlerLog(key: string, body: string) {
  const owner = await repo.findKey(await hashCrawlerKey(key));
  if (!owner) return null;
  const { events, lines, skipped } = parseCrawlerLog(body);
  const groups = new Map<
    string,
    {
      day: string;
      bot: string;
      path: string;
      statusClass: number;
      hits: number;
    }
  >();
  for (const event of events) {
    const bot = detectAiBot(event.userAgent);
    if (!bot) continue;
    const path = pathOf(event.path);
    const statusClass = Math.floor(event.status / 100);
    const id = `${event.day}|${bot}|${path}|${statusClass}`;
    const group = groups.get(id);
    if (group) group.hits += 1;
    else groups.set(id, { day: event.day, bot, path, statusClass, hits: 1 });
  }
  // The per-day path cap applies to a log as it does to live visits.
  let counted = 0;
  for (const group of groups.values()) {
    const path =
      !(await repo.hasPath(owner.projectId, group.day, group.path)) &&
      (await repo.countPaths(owner.projectId, group.day)) >= MAX_PATHS_PER_DAY
        ? OTHER_PATHS
        : group.path;
    await repo.addHits(
      {
        projectId: owner.projectId,
        day: group.day,
        bot: group.bot,
        path,
        statusClass: group.statusClass,
      },
      group.hits,
    );
    counted += group.hits;
  }
  await repo.touchKey(owner.id, new Date().toISOString());
  return { lines, skipped, counted };
}
