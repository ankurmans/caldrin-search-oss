import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import {
  AuthPageCard,
  AuthMethodChooser,
  TermsAgreementNotice,
  authInputClassName,
  authSubmitClassName,
  authRedirectSearchSchema,
  useAuthPageState,
} from "@/client/features/auth/AuthPage";
import {
  EmailOnlyFooter,
  MagicLinkForm,
} from "@/client/features/auth/SignInHelpers";
import { signUpStatusQueryOptions } from "@/client/features/auth/signUpStatus";
import { useGoogleAuth } from "@/client/features/auth/useGoogleAuth";
import { getFormError } from "@/client/lib/forms";
import { captureClientEvent } from "@/client/lib/posthog";
import { authClient } from "@/lib/auth-client";
import {
  getSignInSearch,
  getVerifyEmailSearch,
  toAuthCallbackURL,
} from "@/lib/auth-redirect";
import { z } from "zod";
import { pageHead } from "@/client/lib/pageHead";

const signInSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export const Route = createFileRoute("/_auth/sign-in")({
  head: () => pageHead("Sign in"),
  validateSearch: authRedirectSearchSchema,
  component: SignInPage,
});

function SignInPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { redirectTo, oauthQuery, isBetterAuthMode } = useAuthPageState(
    search.redirect,
  );
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  // Go straight to the email form unless Google is offered. A fresh
  // installation has nobody to sign in, so its first visitor is sent to create
  // the admin account instead.
  const emailOnly = isBetterAuthMode;
  const signUpStatus = useQuery({
    ...signUpStatusQueryOptions(),
    enabled: emailOnly,
  });
  const googleOffered = emailOnly && signUpStatus.data?.googleSignIn === true;
  const magicLinkOffered = emailOnly && signUpStatus.data?.magicLink === true;
  // Anyone can create an account with Google or an emailed link.
  const openSignUp = emailOnly && signUpStatus.data?.openSignUp === true;
  const emailSignUp = emailOnly && signUpStatus.data?.emailSignUp === true;
  // With a magic link on offer the email form is on the first view, next to
  // Google; the password form is one click away.
  const showMagicLink = magicLinkOffered && !usePassword;
  const emailFormVisible =
    showEmailForm ||
    usePassword ||
    showMagicLink ||
    (emailOnly && !googleOffered);
  const google = useGoogleAuth({ redirectTo });
  const firstAccount = signUpStatus.data?.firstAccount === true;
  useEffect(() => {
    if (!firstAccount) return;
    void navigate({
      to: "/sign-up",
      search: getSignInSearch(redirectTo),
      replace: true,
    });
  }, [firstAccount, navigate, redirectTo]);

  const form = useAppForm({
    defaultValues: {
      email: "",
      password: "",
    },
    validators: {
      onSubmit: signInSchema,
    },
    onSubmit: async ({ formApi, value }) => {
      try {
        const email = value.email.trim();
        captureClientEvent("auth:sign_in_submit", {
          redirect_to: redirectTo,
        });

        const result = await authClient.signIn.email({
          email,
          password: value.password,
          callbackURL: toAuthCallbackURL(redirectTo),
          ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
        });

        if (!result.error) {
          captureClientEvent("auth:sign_in_success", {
            redirect_to: redirectTo,
          });
          return;
        }

        if (result.error.status === 403) {
          captureClientEvent("auth:sign_in_block_unverified", {
            redirect_to: redirectTo,
          });
          // Email not verified yet: send them to the verification page (which
          // shows "check your inbox" + resend) instead of leaving them on a
          // sign-in form that will keep rejecting them.
          void navigate({
            to: "/verify-email",
            search: getVerifyEmailSearch(email, redirectTo),
          });
          return;
        }

        formApi.setErrorMap({
          onSubmit: {
            form: result.error.message || "We couldn't sign you in.",
            fields: {},
          },
        });
      } catch {
        formApi.setErrorMap({
          onSubmit: {
            form: "Unable to sign in right now. Please try again.",
            fields: {},
          },
        });
      }
    },
  });

  return (
    <AuthPageCard
      title={openSignUp ? "Sign in or create an account" : "Sign in"}
      footer={
        emailOnly ? (
          <EmailOnlyFooter
            emailSignUp={emailSignUp}
            openSignUp={openSignUp}
            redirectTo={redirectTo}
          />
        ) : null
      }
    >
      {showMagicLink ? (
        <>
          {googleOffered ? (
            <AuthMethodChooser
              googleLabel="Continue with Google"
              google={google}
              emailSlot={
                <MagicLinkForm
                  redirectTo={redirectTo}
                  onUsePassword={() => setUsePassword(true)}
                />
              }
            />
          ) : (
            <MagicLinkForm
              redirectTo={redirectTo}
              onUsePassword={() => setUsePassword(true)}
            />
          )}
          {openSignUp ? <TermsAgreementNotice action="By continuing" /> : null}
          {google.error ? (
            <p className="text-sm text-destructive">{google.error}</p>
          ) : null}
        </>
      ) : !emailFormVisible ? (
        <>
          <AuthMethodChooser
            googleLabel="Continue with Google"
            disabled={!googleOffered}
            google={google}
            onContinueWithEmail={() => {
              setShowEmailForm(true);
              google.clearError();
            }}
          />
          {openSignUp ? <TermsAgreementNotice action="By continuing" /> : null}
          {google.error ? (
            <p className="text-sm text-destructive">{google.error}</p>
          ) : null}
        </>
      ) : (
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
                  autoComplete="current-password"
                  required
                />
              )}
            </form.AppField>

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
                    >
                      {isSubmitting ? "Signing in..." : "Sign in"}
                    </Button>
                    {magicLinkOffered ? (
                      <button
                        type="button"
                        className="w-full text-sm text-foreground/60 underline underline-offset-2 hover:text-foreground"
                        onClick={() => setUsePassword(false)}
                      >
                        Email me a sign-in link instead
                      </button>
                    ) : null}
                  </>
                );
              }}
            </form.Subscribe>
          </form.Form>
        </form.AppForm>
      )}
    </AuthPageCard>
  );
}
