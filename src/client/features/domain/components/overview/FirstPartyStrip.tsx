import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AnalyticsCard,
  SearchConsoleCard,
} from "@/client/features/domain/components/overview/FirstPartySearchCards";
import {
  AiVisibilityCard,
  AuditCard,
} from "@/client/features/domain/components/overview/FirstPartySiteCards";
import type { Input } from "@/client/features/domain/components/overview/FirstPartyShared";
import { getDomainOwnership } from "@/serverFunctions/domain";

/**
 * What the project actually has for its own domain, beside the provider
 * estimates above it. Each source loads on its own and none is added to a
 * provider figure. `children` is a card that belongs in the same flow, so it
 * fills a gap instead of starting a new row below it.
 */
export function FirstPartyStrip({
  projectId,
  domain,
  children,
}: Input & { children?: ReactNode }) {
  const owned = useQuery({
    queryKey: ["domain-ownership", projectId, domain],
    queryFn: () => getDomainOwnership({ data: { projectId, domain } }),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  if (!owned.data?.owned) return <>{children}</>;
  const input = { projectId, domain };

  return (
    <section aria-labelledby="first-party-heading" className="space-y-3">
      <div className="space-y-0.5">
        <h2 id="first-party-heading" className="text-base font-semibold">
          Your verified performance
        </h2>
        <p className="text-xs text-muted-foreground">
          Measured by Search Console and GA4, shown separately from the
          estimates above.
        </p>
      </div>
      {/* Columns, not a grid: a card sits in whichever column has room, so
          none is stretched to its neighbour and no gap is left below one. A
          card with nothing to show leaves an empty wrapper, which is hidden. */}
      <div className="gap-4 xl:columns-2">
        {[
          <SearchConsoleCard key="gsc" input={input} />,
          <AnalyticsCard key="ga" input={input} />,
          <AuditCard key="audit" input={input} />,
          <AiVisibilityCard key="ai" input={input} />,
          children,
        ].map((card, index) => (
          <div key={index} className="break-inside-avoid pb-4 empty:hidden">
            {card}
          </div>
        ))}
      </div>
    </section>
  );
}
