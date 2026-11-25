import { env } from "cloudflare:workers";
import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

const MIN_OPERATOR_SECRET_LENGTH = 32;

// An operator sets this secret in the Worker environment when they need the account
// commands; the modes whose identity comes from outside the app never set it,
// so everything it gates stays off there. A value too short for isOperatorRequest counts as
// unset.
export function hasOperatorSecret(): boolean {
  const secret: unknown = Reflect.get(env, "CALDRIN_SEARCH_OPERATOR_SECRET");
  return (
    typeof secret === "string" && secret.length >= MIN_OPERATOR_SECRET_LENGTH
  );
}

export function isOperatorRequest(headers: Headers | undefined): boolean {
  const secret: unknown = Reflect.get(env, "CALDRIN_SEARCH_OPERATOR_SECRET");
  const supplied = headers?.get("x-caldrin-search-operator-secret");
  if (!hasOperatorSecret() || typeof secret !== "string" || !supplied)
    return false;
  const expectedBytes = Buffer.from(secret);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}
