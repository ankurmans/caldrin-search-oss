import {
  createFileRoute,
  lazyRouteComponent,
  notFound,
} from "@tanstack/react-router";
import { usesBetterAuthClient } from "@/lib/auth-mode";
import { isByokPreview } from "@/lib/byok-preview";

export const Route = createFileRoute("/_app/settings/billing")({
  beforeLoad: () => {
    if (isByokPreview || !usesBetterAuthClient()) throw notFound();
  },
  component: isByokPreview
    ? undefined
    : lazyRouteComponent(
        () => import("@/client/features/billing/BillingSettings"),
        "BillingSettings",
      ),
});
