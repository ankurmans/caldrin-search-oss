import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { DomainAiAnswersService } from "@/server/features/domain/services/domainAiAnswers";
import { DomainIntersectionService } from "@/server/features/domain/services/domainIntersection";
import { DomainIntersectionOpportunityService } from "@/server/features/domain/services/domainIntersectionOpportunity";
import { dataforseoPricing } from "@/server/lib/dataforseo/pricing";
import {
  getDomainE2eFixtures,
  shouldUseDomainE2eFixtures,
} from "@/serverFunctions/domain";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { resolveLabsMarket } from "@/shared/keyword-locations";
import { domainOverviewSchema } from "@/types/schemas/domain";

const firstPartySchema = domainOverviewSchema.pick({
  projectId: true,
  domain: true,
});

// Reads only the lookup that was already paid for, in full.
export const getDomainAiMentions = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(firstPartySchema)
  .handler(async ({ data, context }) => {
    if (shouldUseDomainE2eFixtures()) {
      const fixtures = await getDomainE2eFixtures();
      return fixtures.getFixtureAiMentions(data.domain);
    }
    return DomainAiAnswersService.getMentions(
      {
        domain: data.domain,
        projectId: context.projectId,
        locationCode: context.project.locationCode,
        languageCode: context.project.languageCode,
      },
      context,
    );
  });

const intersectionSchema = domainOverviewSchema.pick({
  projectId: true,
  domain: true,
  scope: true,
  locationCode: true,
  languageCode: true,
});

function intersectionInput(
  data: z.infer<typeof intersectionSchema>,
  context: {
    projectId: string;
    project: {
      domain?: string | null;
      locationCode: number;
      languageCode: string;
    };
  },
) {
  return {
    ...resolveLabsMarket(data, context.project),
    projectId: context.projectId,
    domain: data.domain,
    scope: data.scope,
    projectDomain: context.project.domain ?? null,
  };
}

// Stored data only: a missing organic or AI reading is reported, never bought.
export const getDomainIntersection = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(intersectionSchema)
  .handler(async ({ data, context }) => {
    if (shouldUseDomainE2eFixtures()) {
      const fixtures = await getDomainE2eFixtures();
      return fixtures.getFixtureIntersection(data.domain);
    }
    return DomainIntersectionService.getIntersection(
      intersectionInput(data, context),
      context,
    );
  });

export const createIntersectionOpportunity = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(intersectionSchema.extend({ query: z.string().min(1).max(500) }))
  .handler(({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return DomainIntersectionOpportunityService.createOpportunity(
      {
        ...intersectionInput(data, context),
        query: data.query,
        organizationId: context.organizationId,
      },
      context,
    );
  });

// What reading one live SERP would cost, before anything is read.
export const estimateLiveSerp = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    z.object({
      projectId: z.string().min(1),
      query: z.string().min(1).max(500),
    }),
  )
  .handler(({ data, context }) => ({
    estimateUsd: dataforseoPricing.serp.readsTaskPost({
      keyword: data.query,
      depth: 10,
      locationCode: context.project.locationCode,
      languageCode: context.project.languageCode,
    }),
  }));
