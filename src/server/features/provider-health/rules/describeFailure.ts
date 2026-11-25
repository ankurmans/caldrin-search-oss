import { AppError } from "@/server/lib/errors";

type FailureKind =
  | "auth"
  | "rate_limited"
  | "upstream"
  | "rejected"
  | "invalid_response"
  | "unknown";

const MESSAGE_LIMIT = 500;

/**
 * What to store about a provider failure: a kind, the HTTP status when there
 * was one, and the provider's own words (its status message or a trimmed
 * response body), which is what says why a request was refused. Never the
 * request, so no key or customer input is stored.
 */
export function describeFailure(error: unknown): {
  kind: FailureKind;
  httpStatus: number | null;
  message: string;
} {
  if (!(error instanceof Error)) {
    return { kind: "unknown", httpStatus: null, message: String(error) };
  }
  const status =
    error instanceof AppError && error.details?.providerStatus
      ? Number(error.details.providerStatus)
      : null;
  const body =
    error instanceof AppError ? error.details?.responseBody : undefined;
  const message = [error.message, body].filter(Boolean).join(" | ");
  return {
    kind: kindOf(error, status),
    httpStatus: Number.isFinite(status) ? status : null,
    message: message.slice(0, MESSAGE_LIMIT),
  };
}

function kindOf(error: Error, status: number | null): FailureKind {
  const code = error instanceof AppError ? error.code : null;
  if (code === "DATAFORSEO_AUTH_FAILED" || status === 401 || status === 403) {
    return "auth";
  }
  if (code === "RATE_LIMITED" || status === 429) return "rate_limited";
  if (code === "UPSTREAM_UNAVAILABLE" || (status !== null && status >= 500)) {
    return "upstream";
  }
  if (/invalid response shape/i.test(error.message)) {
    return "invalid_response";
  }
  // A 200 whose task refused the request (a bad field, a limit) surfaces as an
  // internal error carrying the provider's message: it changed its rules or we
  // sent something it no longer accepts.
  if (code === "INTERNAL_ERROR") return "rejected";
  return "unknown";
}
