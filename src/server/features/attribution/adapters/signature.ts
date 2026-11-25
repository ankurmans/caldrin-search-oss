export function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time comparison of two equal-purpose signature strings. */
export function sameSignature(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Text a connector may carry in an event, bounded so it cannot bloat the ledger. */
export const metaText = (
  m: Record<string, unknown> | undefined,
  key: string,
) => {
  const v = m?.[key];
  return typeof v === "string" && v.length > 0 && v.length <= 200 ? v : null;
};
