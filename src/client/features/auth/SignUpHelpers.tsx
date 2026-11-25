import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AuthPageCard } from "@/client/features/auth/AuthPage";
import { getSignInSearch } from "@/lib/auth-redirect";

// Open sign-up without a password form has no separate page: Google and the
// emailed link on the sign-in page create the account.
export function useRedirectToSignInWhenOpen({
  enabled,
  redirectTo,
}: {
  enabled: boolean;
  redirectTo: string;
}) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!enabled) return;
    void navigate({
      to: "/sign-in",
      search: getSignInSearch(redirectTo),
      replace: true,
    });
  }, [enabled, navigate, redirectTo]);
}

export function RegistrationClosedCard({ redirectTo }: { redirectTo: string }) {
  return (
    <AuthPageCard
      title="Registration is closed"
      helperText="Ask an administrator for an invitation."
      footer={
        <p className="text-sm">
          <Link
            to="/sign-in"
            search={getSignInSearch(redirectTo)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Back to sign in
          </Link>
        </p>
      }
    >
      {null}
    </AuthPageCard>
  );
}
