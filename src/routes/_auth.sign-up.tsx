import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageLoading } from "@/client/components/Spinner";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import {
  AuthPageCard,
  authInputClassName,
  authSubmitClassName,
  authRedirectSearchSchema,
  useAuthPageState,
} from "@/client/features/auth/AuthPage";
import {
  TURNSTILE_SITE_KEY,
  TurnstileWidget,
  useTurnstileCaptcha,
} from "@/client/features/auth/TurnstileWidget";
import { passwordSchema } from "@/client/features/auth/passwordSchema";
import { signUpStatusQueryOptions } from "@/client/features/auth/signUpStatus";
import { getFormError } from "@/client/lib/forms";
import { captureClientEvent } from "@/client/lib/posthog";
import { authClient } from "@/lib/auth-client";
import {
  getSignInSearch,
  getVerifyEmailSearch,
  toAuthCallbackURL,
} from "@/lib/auth-redirect";
import { z } from "zod";
import {
  RegistrationClosedCard,
  useRedirectToSignInWhenOpen,
} from "@/client/features/auth/SignUpHelpers";
import { pageHead } from "@/client/lib/pageHead";

const signUpSchema = z
  .object({
    email: z.string().trim().email("Enter a valid email address."),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const Route = createFileRoute("/_auth/sign-up")({
  head: () => pageHead("Sign up"),
  validateSearch: authRedirectSearchSchema,
  component: SignUpPage,
});

function SignUpPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { redirectTo, isBetterAuthMode } = useAuthPageState(search.redirect);
  const postSignupRedirect = redirectTo;

  // The server accepts a sign-up only for the first account, an invited
  // address, or open sign-up (src/server/standalone/sign-up.ts).
  const invited = redirectTo.startsWith("/accept-invitation/");
  const signUpStatus = useQuery({
    ...signUpStatusQueryOptions(),
    enabled: isBetterAuthMode,
  });
  const firstAccount = signUpStatus.data?.firstAccount === true;
  const emailSignUp = signUpStatus.data?.emailSignUp === true;
  useRedirectToSignInWhenOpen({
    enabled:
      isBetterAuthMode &&
      signUpStatus.data?.openSignUp === true &&
      !emailSignUp &&
      !firstAccount,
    redirectTo,
  });

  const isTurnstileEnabled = emailSignUp && Boolean(TURNSTILE_SITE_KEY);
  const captcha = useTurnstileCaptcha();

  const form = useAppForm({
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
    },
    validators: {
      onSubmit: signUpSchema,
    },
    onSubmit: async ({ formApi, value }) => {
      const captchaToken = captcha.tokenRef.current;
      try {
        const email = value.email.trim();
        captureClientEvent("auth:sign_up_submit", {
          redirect_to: redirectTo,
        });
        const verificationCallbackURL = new URL(
          "/verify-email",
          window.location.origin,
        );
        const verificationSearch = getVerifyEmailSearch(
          undefined,
          postSignupRedirect,
        );
        if (verificationSearch.redirect) {
          verificationCallbackURL.searchParams.set(
            "redirect",
            verificationSearch.redirect,
          );
        }
        const result = await authClient.signUp.email({
          name: email.split("@")[0] || "Caldrin Search User",
          email,
          password: value.password,
          callbackURL: verificationCallbackURL.toString(),
          ...(isTurnstileEnabled && captchaToken
            ? {
                fetchOptions: {
                  headers: { "x-captcha-response": captchaToken },
                },
              }
            : {}),
        });

        if (result.error) {
          // Tokens are single-use; re-challenge so a retry can succeed.
          if (isTurnstileEnabled) captcha.reset();
          formApi.setErrorMap({
            onSubmit: {
              form: result.error.message || "Unable to create account.",
              fields: {},
            },
          });
          return;
        }

        captureClientEvent("auth:sign_up_success", {
          redirect_to: redirectTo,
        });
        if (!emailSignUp) {
          // Nothing to verify here, and autoSignIn is off so the operator's
          // create-user never mints a session: sign in explicitly, and the
          // layout sends the new session to redirectTo.
          const signedIn = await authClient.signIn.email({
            email,
            password: value.password,
            callbackURL: toAuthCallbackURL(redirectTo),
          });
          if (signedIn.error) {
            formApi.setErrorMap({
              onSubmit: {
                form:
                  signedIn.error.message ||
                  "Account created. Sign in to continue.",
                fields: {},
              },
            });
          }
          return;
        }
        void navigate({
          to: "/verify-email",
          search: getVerifyEmailSearch(email, postSignupRedirect),
          replace: true,
        });
      } catch {
        if (isTurnstileEnabled) captcha.reset();
        formApi.setErrorMap({
          onSubmit: {
            form: "Unable to create account right now. Please try again.",
            fields: {},
          },
        });
      }
    },
  });

  if (!firstAccount && !invited && !emailSignUp) {
    if (signUpStatus.isPending) return <PageLoading />;
    return <RegistrationClosedCard redirectTo={redirectTo} />;
  }

  return (
    <AuthPageCard
      title={firstAccount ? "Create the admin account" : "Create your account"}
      helperText={
        firstAccount
          ? "This installation has no accounts yet. The first one becomes the administrator."
          : invited
            ? "Use the email address that received the invitation."
            : undefined
      }
      footer={
        firstAccount ? null : (
          <p className="text-sm text-foreground/50">
            Already have an account?{" "}
            <Link
              to="/sign-in"
              search={getSignInSearch(redirectTo)}
              className="text-foreground underline underline-offset-2 hover:text-foreground/80 transition-colors"
            >
              Sign in
            </Link>
          </p>
        )
      }
    >
      <form.AppForm>
        <form.Form className="space-y-4">
          <form.AppField name="email">
            {(field) => (
              <field.TextField
                label="Email address"
                hideLabel
                className={authInputClassName}
                type="email"
                placeholder="Email address..."
                autoComplete="email"
                required
              />
            )}
          </form.AppField>
          <form.AppField name="password">
            {(field) => (
              <field.TextField
                label="Password"
                hideLabel
                className={authInputClassName}
                type="password"
                placeholder="Password..."
                autoComplete="new-password"
                required
              />
            )}
          </form.AppField>
          <form.AppField name="confirmPassword">
            {(field) => (
              <field.TextField
                label="Confirm password"
                hideLabel
                className={authInputClassName}
                type="password"
                placeholder="Confirm password..."
                autoComplete="new-password"
                required
              />
            )}
          </form.AppField>

          {isTurnstileEnabled ? (
            <TurnstileWidget
              onToken={captcha.onToken}
              resetNonce={captcha.resetNonce}
            />
          ) : null}

          <form.Subscribe
            selector={(state) => ({
              submitError: state.errorMap.onSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ submitError, isSubmitting }) => {
              const errorMessage = getFormError(submitError);
              return (
                <>
                  {errorMessage ? (
                    <p className="text-sm text-destructive">{errorMessage}</p>
                  ) : null}
                  <Button
                    type="submit"
                    variant="secondary"
                    className={authSubmitClassName}
                    pending={isSubmitting}
                    disabled={isTurnstileEnabled && !captcha.hasToken}
                  >
                    {isSubmitting ? "Creating account..." : "Create account"}
                  </Button>
                </>
              );
            }}
          </form.Subscribe>
        </form.Form>
      </form.AppForm>
    </AuthPageCard>
  );
}
