import { Link } from "@tanstack/react-router";
import { Button } from "@/client/components/ui/button";

/** The two ways past the end of the free test run. */
export function TrialEndedActions({
  size = "sm",
}: {
  size?: "sm" | "default";
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size={size}
        className="text-foreground"
        nativeButton={false}
        render={<Link to="/settings/organization" />}
      >
        Add your keys
      </Button>
      <Button
        variant="outline"
        size={size}
        className="text-foreground"
        nativeButton={false}
        render={<Link to="/settings/billing" />}
      >
        See plans
      </Button>
    </span>
  );
}
