import { queryClient } from "@/client/tanstack-db/queryClient";
import { googleConnectionOptions } from "@/client/features/integrations/googleProviders";
import { createFileRoute } from "@tanstack/react-router";
import { GoogleConnectionCard } from "@/client/features/integrations/GoogleConnectionCard";
import { CrawlerAccessSettings } from "@/client/features/settings/CrawlerAccessSettings";
import { AttributionInstallCard } from "@/client/features/attribution/AttributionInstallCard";
import { AttributionRevenueSourcesCard } from "@/client/features/attribution/AttributionRevenueSourcesCard";
import { StoreIntegration } from "@/client/features/content/StoreIntegration";
import { ShopifyPlatformGate } from "@/client/features/content/ShopifyPlatformGate";

export const Route = createFileRoute(
  "/_app/p/$projectId/settings/integrations",
)({
  loader: ({ params }) => {
    // Start both database checks on link intent without holding up navigation.
    void queryClient.prefetchQuery(
      googleConnectionOptions("gsc", params.projectId),
    );
    void queryClient.prefetchQuery(
      googleConnectionOptions("ga4", params.projectId),
    );
  },
  component: ProjectIntegrationsRoute,
});

function ProjectIntegrationsRoute() {
  const { projectId } = Route.useParams();

  return (
    <div className="space-y-8">
      {/* The ids are the targets old #search-console / #google-analytics deep
          links are redirected to from the settings index. Each card's title
          names its integration, so the sections carry no heading. */}
      <div className="grid gap-4 md:grid-cols-2">
        <section id="search-console" className="scroll-mt-6">
          <GoogleConnectionCard provider="gsc" projectId={projectId} />
        </section>

        <section id="google-analytics" className="scroll-mt-6">
          <GoogleConnectionCard provider="ga4" projectId={projectId} />
        </section>
      </div>

      <section
        id="revenue-attribution"
        className="@container scroll-mt-6 space-y-4"
      >
        <AttributionInstallCard projectId={projectId} />
        <AttributionRevenueSourcesCard projectId={projectId} />
      </section>

      {/* Both Shopify cards live behind one link for projects that are not on
          Shopify. The store card keeps its #store anchor. */}
      <ShopifyPlatformGate projectId={projectId}>
        <div className="space-y-8">
          <section id="store" className="scroll-mt-6">
            <StoreIntegration projectId={projectId} />
          </section>
          <CrawlerAccessSettings projectId={projectId} />
        </div>
      </ShopifyPlatformGate>
    </div>
  );
}
