import { z } from "zod";

export interface CrawlerLogEvent {
  /** UTC date, YYYY-MM-DD. */
  day: string;
  userAgent: string;
  path: string;
  status: number;
}

const DAY_MS = 86_400_000;
const MAX_AGE_DAYS = 365;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Apache and nginx "combined" format.
const COMBINED =
  /^\S+ \S+ \S+ \[(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})\] "\S+ (\S+)[^"]*" (\d{3}) \S+ "[^"]*" "([^"]*)"/;

// A Vercel log drain sends the request's own fields under `proxy`.
const vercelLine = z.object({
  timestamp: z.number(),
  proxy: z.object({
    path: z.string(),
    statusCode: z.number().int(),
    userAgent: z.union([z.string(), z.array(z.string())]).optional(),
  }),
});

function fromCombined(line: string): CrawlerLogEvent | null {
  const m = COMBINED.exec(line);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]);
  if (month < 0) return null;
  const offset = m[7];
  const minutes =
    (offset.startsWith("-") ? -1 : 1) *
    (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(3)));
  const at = new Date(
    Date.UTC(+m[3], month, +m[1], +m[4], +m[5], +m[6]) - minutes * 60_000,
  );
  return {
    day: at.toISOString().slice(0, 10),
    path: m[8],
    status: Number(m[9]),
    userAgent: m[10],
  };
}

function fromVercel(value: unknown): CrawlerLogEvent | null {
  const parsed = vercelLine.safeParse(value);
  if (!parsed.success) return null;
  const { timestamp, proxy } = parsed.data;
  const userAgent = Array.isArray(proxy.userAgent)
    ? (proxy.userAgent[0] ?? "")
    : (proxy.userAgent ?? "");
  return {
    day: new Date(timestamp).toISOString().slice(0, 10),
    path: proxy.path,
    status: proxy.statusCode,
    userAgent,
  };
}

function parseLine(line: string): CrawlerLogEvent | null {
  if (line.startsWith("{")) {
    try {
      return fromVercel(JSON.parse(line));
    } catch {
      return null;
    }
  }
  return fromCombined(line);
}

/**
 * Reads an access log or Vercel log-drain body: one combined-format line, one
 * JSON object per line, or a JSON array of drain objects. Lines that do not
 * parse or fall outside the last year are counted as skipped.
 */
export function parseCrawlerLog(text: string, now = new Date()) {
  let lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (text.trimStart().startsWith("[")) {
    try {
      const array: unknown = JSON.parse(text);
      lines = Array.isArray(array)
        ? array.map((item) => JSON.stringify(item))
        : lines;
    } catch {
      // Falls through to line-by-line parsing, which skips what it cannot read.
    }
  }
  const oldest = new Date(now.getTime() - MAX_AGE_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const newest = new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10);
  const events: CrawlerLogEvent[] = [];
  for (const line of lines) {
    const event = parseLine(line);
    if (
      event &&
      event.status >= 100 &&
      event.status <= 599 &&
      event.day >= oldest &&
      event.day <= newest
    )
      events.push(event);
  }
  return { events, lines: lines.length, skipped: lines.length - events.length };
}
