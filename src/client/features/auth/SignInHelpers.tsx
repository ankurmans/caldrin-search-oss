import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/client/components/ui/button";
import {
  authInputClassName,
  authSubmitClassName,
} from "@/client/features/auth/AuthPage";
import {
  TURNSTILE_SITE_KEY,
  TurnstileWidget,
  useTurnstileCaptcha,
} from "@/client/features/auth/TurnstileWidget";
import { authClient } from "@/lib/auth-client";
import { getSignInSearch, toAuthCallbackURL } from "@/lib/auth-redirect";

export function EmailOnlyFooter({
  emailSignUp,
  openSignUp,
  redirectTo,
}: {
  emailSignUp: boolean;
  openSignUp: boolean;
  redirectTo: string;
}) {
  if (!emailSignUp) {
    return (
      <p className="text-sm text-foreground/50">
        {openSignUp
          ? "New here? Continue with Google and your workspace is created."
          : "Need an account? Ask an administrator for an invitation."}
      </p>
    );
  }
  const linkClass =
    "text-foreground underline underline-offset-2 hover:text-foreground/80 transition-colors";
  return (
    <div className="flex w-full justify-between text-sm text-foreground/50">
      <Link
        to="/forgot-password"
        search={getSignInSearch(redirectTo)}
        className={linkClass}
      >
        Forgot password?
      </Link>
      <Link
        to="/sign-up"
        search={getSignInSearch(redirectTo)}
        className={linkClass}
      >
        Create account
      </Link>
    </div>
  );
}

export function MagicLinkForm({
  redirectTo,
  onUsePassword,
}: {
  redirectTo: string;
  onUsePassword: () => void;
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const captcha = useTurnstileCaptcha();
  const challenged = Boolean(TURNSTILE_SITE_KEY);

  // The session cookie is set by this call; the auth layout then moves a
  // signed-in visitor on to redirectTo, as it does after a password sign-in.
  async function verifyCode() {
    setError(null);
    setVerifying(true);
    try {
      const result = await authClient.signIn.emailOtp({
        email: email.trim(),
        otp: code,
      });
      if (result.error) {
        setError(result.error.message || "That code didn't work.");
        setVerifying(false);
      }
    } catch {
      setError("We couldn't check the code. Try again.");
      setVerifying(false);
    }
  }

  async function send() {
    setError(null);
    setState("sending");
    try {
      const captchaToken = captcha.tokenRef.current;
      const result = await authClient.signIn.magicLink({
        email: email.trim(),
        callbackURL: toAuthCallbackURL(redirectTo),
        ...(challenged && captchaToken
          ? {
              fetchOptions: { headers: { "x-captcha-response": captchaToken } },
            }
          : {}),
      });
      if (challenged) captcha.reset();
      if (result.error) {
        setError(result.error.message || "We couldn't send the link.");
        setState("idle");
        return;
      }
      setState("sent");
    } catch {
      setError("We couldn't send the link. Try again.");
      setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <form
        className="space-y-4 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          void verifyCode();
        }}
      >
        <p>
          If {email.trim()} can sign in here, a link and a 6-digit code are on
          their way. They work once and expire in 10 minutes.
        </p>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          placeholder="6-digit code"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          className={`${authInputClassName} h-10 w-full rounded-md border px-3 text-center tracking-widest`}
        />
        {error ? <p className="text-destructive">{error}</p> : null}
        <Button
          type="submit"
          variant="secondary"
          className={authSubmitClassName}
          pending={verifying}
          disabled={code.length !== 6}
        >
          Sign in with code
        </Button>
        <button
          type="button"
          className="w-full text-foreground/60 underline underline-offset-2"
          onClick={() => {
            setState("idle");
            setCode("");
            setError(null);
          }}
        >
          Back to sign in
        </button>
      </form>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <input
        type="email"
        required
        autoComplete="email"
        placeholder="Email address..."
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className={`${authInputClassName} h-10 w-full rounded-md border px-3`}
      />
      {challenged ? (
        <TurnstileWidget
          onToken={captcha.onToken}
          resetNonce={captcha.resetNonce}
        />
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button
        type="submit"
        variant="secondary"
        className={authSubmitClassName}
        pending={state === "sending"}
        disabled={challenged && !captcha.hasToken}
      >
        Email me a link
      </Button>
      <button
        type="button"
        className="w-full text-sm text-foreground/60 underline underline-offset-2 hover:text-foreground"
        onClick={onUsePassword}
      >
        Use a password instead
      </button>
    </form>
  );
}
