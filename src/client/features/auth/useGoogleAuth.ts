import { useState } from "react";
import { captureClientEvent } from "@/client/lib/posthog";
import { authClient } from "@/lib/auth-client";
import { toAuthCallbackURL } from "@/lib/auth-redirect";

/** Starts Google sign-in: a full-page redirect to Google. */
export function useGoogleAuth({ redirectTo }: { redirectTo: string }) {
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fallbackMessage = "Google sign in is not available right now.";

  async function start() {
    setError(null);
    setIsStarting(true);
    try {
      captureClientEvent("auth:sign_in_google_start", {
        redirect_to: redirectTo,
      });
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: toAuthCallbackURL(redirectTo),
      });
      if (!result.error) return;
      setError(result.error.message || fallbackMessage);
    } catch {
      setError(fallbackMessage);
    }
    setIsStarting(false);
  }

  return { isStarting, error, start, clearError: () => setError(null) };
}
