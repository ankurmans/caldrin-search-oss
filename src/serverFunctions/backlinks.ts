import { createServerFn } from "@tanstack/react-start";
import { BacklinksService } from "@/server/features/backlinks/services/BacklinksService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  anchorsPageRequestSchema,
  backlinksOverviewInputSchema,
  backlinksRowsPageRequestSchema,
  referringDomainsPageRequestSchema,
  topPagesPageRequestSchema,
} from "@/types/schemas/backlinks";

// Referring-domain scores aggregate multiple links and retain their own filters.
const WEB_SPAM_OPTIONS = { hideSpam: false };

export const getBacklinksOverview = createServerFn({
  method: "POST",
})
  .middleware(requireProjectContext)
  .validator(backlinksOverviewInputSchema)
  .handler(async ({ data, context }) => {
    const profile = await BacklinksService.profileOverview(
      {
        target: data.target,
        scope: data.scope,
      },
      context,
    );
    return profile.overview;
  });

// Cache only: answers null until a read has paid for the overview.
export const getStoredBacklinksOverview = createServerFn({
  method: "POST",
})
  .middleware(requireProjectContext)
  .validator(backlinksOverviewInputSchema)
  .handler(({ data, context }) =>
    BacklinksService.storedOverview(
      { target: data.target, scope: data.scope },
      context,
    ),
  );

export const getBacklinksRows = createServerFn({
  method: "POST",
})
  .middleware(requireProjectContext)
  .validator(backlinksRowsPageRequestSchema)
  .handler(({ data, context }) =>
    BacklinksService.profileBacklinksPage(data, context, {
      hideSpam: data.hideSpam ?? true,
    }),
  );

export const getBacklinksReferringDomains = createServerFn({
  method: "POST",
})
  .middleware(requireProjectContext)
  .validator(referringDomainsPageRequestSchema)
  .handler(({ data, context }) =>
    BacklinksService.profileReferringDomainsPage(
      data,
      context,
      WEB_SPAM_OPTIONS,
    ),
  );

export const getBacklinksTopPages = createServerFn({
  method: "POST",
})
  .middleware(requireProjectContext)
  .validator(topPagesPageRequestSchema)
  .handler(({ data, context }) =>
    BacklinksService.profileTopPagesPage(data, context),
  );

export const getBacklinksAnchors = createServerFn({
  method: "POST",
})
  .middleware(requireProjectContext)
  .validator(anchorsPageRequestSchema)
  .handler(({ data, context }) =>
    BacklinksService.profileAnchorsPage(data, context),
  );
