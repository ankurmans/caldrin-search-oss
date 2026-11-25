import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  domainOverviewSchema,
  domainKeywordSuggestionsSchema,
  domainKeywordsPageRequestSchema,
  domainPagesPageRequestSchema,
} from "@/types/schemas/domain";
import { parseResearchTargetOrThrow } from "@/server/lib/domainUtils";
import { DomainService } from "@/server/features/domain/services/DomainService";
import {
  DomainMarketsService,
  MAX_MARKETS,
} from "@/server/features/domain/services/domainMarkets";
import { DomainFirstPartyService } from "@/server/features/domain/services/domainFirstParty";
import { recordResearchStep } from "@/server/features/activation/researchActivation";
import {
  isLabsLocationCode,
  resolveLabsMarket,
} from "@/shared/keyword-locations";

export function shouldUseDomainE2eFixtures() {
  return import.meta.env.VITE_E2E_DOMAIN_FIXTURES === "1";
}

export async function getDomainE2eFixtures() {
  return import("../../tests/fixtures/domain-overview-fixtures");
}

export const getDomainOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(domainOverviewSchema)
  .handler(async ({ data, context }) => {
    const input = {
      ...data,
      ...resolveLabsMarket(data, context.project),
      projectId: context.projectId,
    };
    if (shouldUseDomainE2eFixtures()) {
      const fixtures = await getDomainE2eFixtures();
      return fixtures.getFixtureOverview(input.domain);
    }

    const overview = await DomainService.getOverview(input, context);
    await recordResearchStep(context.projectId, "competitor");
    return overview;
  });

// Cache only: answers null until a read has paid for the overview, so opening
// Site Explorer on a domain never starts a provider charge.
export const getStoredDomainOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(domainOverviewSchema)
  .handler(async ({ data, context }) => {
    if (shouldUseDomainE2eFixtures()) {
      const fixtures = await getDomainE2eFixtures();
      return fixtures.getFixtureOverview(data.domain);
    }
    const target = parseResearchTargetOrThrow(data.domain, data.scope);
    const stored = await DomainService.getStoredOverview(
      {
        domain: data.domain,
        ...resolveLabsMarket(data, context.project),
        projectId: context.projectId,
      },
      context,
    );
    return stored
      ? { ...stored, scope: target.scope, displayTarget: target.display }
      : null;
  });

export const getStoredDomainHistory = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(domainOverviewSchema)
  .handler(async ({ data, context }) => {
    if (shouldUseDomainE2eFixtures()) {
      const fixtures = await getDomainE2eFixtures();
      return fixtures.getFixtureHistory(data.domain);
    }
    return DomainService.getStoredHistory(
      {
        domain: data.domain,
        ...resolveLabsMarket(data, context.project),
        projectId: context.projectId,
      },
      context,
    );
  });

export const getDomainHistory = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(domainOverviewSchema)
  .handler(async ({ data, context }) => {
    if (shouldUseDomainE2eFixtures()) {
      const fixtures = await getDomainE2eFixtures();
      return fixtures.getFixtureHistory(data.domain);
    }
    return DomainService.getHistory(
      {
        domain: data.domain,
        ...resolveLabsMarket(data, context.project),
        projectId: context.projectId,
      },
      context,
    );
  });

export const getDomainKeywordSummary = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(domainOverviewSchema)
  .handler(async ({ data, context }) => {
    if (shouldUseDomainE2eFixtures()) {
      const fixtures = await getDomainE2eFixtures();
      return fixtures.getFixtureKeywordSummary(data.domain);
    }
    return DomainService.getKeywordSummary(
      {
        ...data,
        ...resolveLabsMarket(data, context.project),
        projectId: context.projectId,
      },
      context,
    );
  });

export const getDomainPagesSummary = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(domainOverviewSchema)
  .handler(async ({ data, context }) => {
    if (shouldUseDomainE2eFixtures()) {
      const fixtures = await getDomainE2eFixtures();
      return fixtures.getFixturePagesSummary(data.domain);
    }
    return DomainService.getPagesSummary(
      {
        ...data,
        ...resolveLabsMarket(data, context.project),
        projectId: context.projectId,
      },
      context,
    );
  });

export const getDomainCompetitors = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(domainOverviewSchema)
  .handler(async ({ data, context }) => {
    if (shouldUseDomainE2eFixtures()) {
      const fixtures = await getDomainE2eFixtures();
      return fixtures.getFixtureCompetitors(data.domain);
    }
    return DomainService.getCompetitors(
      {
        domain: data.domain,
        ...resolveLabsMarket(data, context.project),
        projectId: context.projectId,
      },
      context,
    );
  });

// One paid read, started only by the click that asks for it.
export const getDomainHeadToHead = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    domainOverviewSchema.extend({
      competitor: z.string().min(1).max(253),
      kind: z.enum(["gap", "shared"]),
    }),
  )
  .handler(async ({ data, context }) => {
    if (shouldUseDomainE2eFixtures()) {
      const fixtures = await getDomainE2eFixtures();
      return fixtures.getFixtureHeadToHead(
        data.domain,
        data.competitor,
        data.kind,
      );
    }
    return DomainService.getHeadToHead(
      {
        domain: data.domain,
        competitor: data.competitor,
        kind: data.kind,
        ...resolveLabsMarket(data, context.project),
        projectId: context.projectId,
      },
      context,
    );
  });

const firstPartySchema = domainOverviewSchema.pick({
  projectId: true,
  domain: true,
});

// Search Console, GA4, Site Audit and AI visibility are the project's own
// data, read per source so one failing connection never blanks the others.
// Every read answers "not_own_domain" for any domain but the project's own.
export const getDomainOwnership = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(firstPartySchema)
  .handler(async ({ data, context }) => {
    if (shouldUseDomainE2eFixtures()) return { owned: false };
    return DomainFirstPartyService.ownsDomain({
      projectId: context.projectId,
      domain: data.domain,
    });
  });

export const getDomainSearchConsole = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(firstPartySchema)
  .handler(({ data, context }) =>
    DomainFirstPartyService.getSearchConsole({
      projectId: context.projectId,
      domain: data.domain,
    }),
  );

export const getDomainAnalytics = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(firstPartySchema)
  .handler(({ data, context }) =>
    DomainFirstPartyService.getAnalytics({
      projectId: context.projectId,
      domain: data.domain,
    }),
  );

export const getDomainAuditHealth = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(firstPartySchema)
  .handler(({ data, context }) =>
    DomainFirstPartyService.getAuditHealth({
      projectId: context.projectId,
      domain: data.domain,
    }),
  );

export const getDomainAiVisibility = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(firstPartySchema)
  .handler(({ data, context }) =>
    DomainFirstPartyService.getAiVisibility({
      projectId: context.projectId,
      domain: data.domain,
    }),
  );

const marketsSchema = domainOverviewSchema
  .pick({ projectId: true, domain: true })
  .extend({
    locationCodes: z
      .array(z.number().int().refine(isLabsLocationCode))
      .min(1)
      .max(MAX_MARKETS),
  });

// Preview first: it reads only the cache. The read is a second call that the
// page makes after the person has seen the cost and confirmed.
export const planDomainMarkets = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(marketsSchema)
  .handler(({ data, context }) =>
    DomainMarketsService.planMarkets(
      { ...data, projectId: context.projectId },
      context,
    ),
  );

export const readDomainMarkets = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(marketsSchema)
  .handler(({ data, context }) =>
    DomainMarketsService.readMarkets(
      { ...data, projectId: context.projectId },
      context,
    ),
  );

export const getDomainKeywordSuggestions = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(domainKeywordSuggestionsSchema)
  .handler(async ({ data, context }) =>
    DomainService.getSuggestedKeywords(
      {
        ...data,
        ...resolveLabsMarket(data, context.project),
        organizationId: context.organizationId,
        projectId: context.projectId,
      },
      context,
    ),
  );

export const getDomainKeywordsPage = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(domainKeywordsPageRequestSchema)
  .handler(async ({ data, context }) => {
    const input = {
      ...data,
      ...resolveLabsMarket(data, context.project),
      projectId: context.projectId,
    };
    if (shouldUseDomainE2eFixtures()) {
      const fixtures = await getDomainE2eFixtures();
      return fixtures.getFixtureKeywordsPage(input);
    }

    return DomainService.getKeywordsPage(input, context);
  });

export const getDomainPagesPage = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(domainPagesPageRequestSchema)
  .handler(async ({ data, context }) => {
    const input = {
      ...data,
      ...resolveLabsMarket(data, context.project),
      projectId: context.projectId,
    };
    if (shouldUseDomainE2eFixtures()) {
      const fixtures = await getDomainE2eFixtures();
      return fixtures.getFixturePagesPage(input);
    }

    return DomainService.getPagesPage(input, context);
  });
