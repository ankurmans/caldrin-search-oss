export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 600;
const windows = new Map<string, { start: number; count: number }>();

/**
 * A burst limit per write key inside one isolate. It is a backstop against a
 * runaway client, not a quota: the daily event limit in project settings is
 * what bounds volume.
 */
export function allowRequest(keyId: string, now = Date.now()) {
  const current = windows.get(keyId);
  if (!current || now - current.start >= WINDOW_MS) {
    if (windows.size > 5000) windows.clear();
    windows.set(keyId, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= MAX_REQUESTS_PER_WINDOW;
}

/** True when the client declares a body over the limit, so it is refused before being read. */
export function declaresTooLarge(request: Request, maxBytes: number) {
  const declared = Number(request.headers.get("content-length"));
  return Number.isFinite(declared) && declared > maxBytes;
}
