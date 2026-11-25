import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  getAttributionAiReferralsFn,
  getAttributionChangeMovementFn,
  getAttributionFindingsFn,
  getAttributionKeywordsFn,
  getAttributionLandingPagesFn,
} from "@/serverFunctions/attributionSearch";
import type { ReportParams } from "./attributionQueries";
import { attributionKey } from "./useAttributionSetup";

export const useLandingPages = (p: ReportParams) =>
  useQuery({
    queryKey: attributionKey(
      p.projectId,
      "landing",
      p.range,
      p.model,
      p.demo,
      p.brandId,
    ),
    queryFn: () => getAttributionLandingPagesFn({ data: p }),
    placeholderData: keepPreviousData,
  });

export const useAiReferrals = (p: ReportParams) =>
  useQuery({
    queryKey: attributionKey(
      p.projectId,
      "ai",
      p.range,
      p.model,
      p.demo,
      p.brandId,
    ),
    queryFn: () => getAttributionAiReferralsFn({ data: p }),
    placeholderData: keepPreviousData,
  });

export const useFindings = (p: ReportParams) =>
  useQuery({
    queryKey: attributionKey(
      p.projectId,
      "findings",
      p.range,
      p.model,
      p.demo,
      p.brandId,
    ),
    queryFn: () => getAttributionFindingsFn({ data: p }),
    placeholderData: keepPreviousData,
  });

type PageTarget = { host: string; path: string };
const NO_PAGE: PageTarget = { host: "", path: "/" };

export const useKeywordAssociations = (
  p: ReportParams,
  page: PageTarget | null,
) =>
  useQuery({
    queryKey: attributionKey(
      p.projectId,
      "keywords",
      page,
      p.range,
      p.model,
      p.demo,
      p.brandId,
    ),
    queryFn: () =>
      getAttributionKeywordsFn({ data: { ...p, ...(page ?? NO_PAGE) } }),
    enabled: Boolean(page),
  });

export const useChangeMovement = (p: ReportParams, page: PageTarget | null) =>
  useQuery({
    queryKey: attributionKey(
      p.projectId,
      "movement",
      page,
      p.model,
      p.demo,
      p.brandId,
    ),
    queryFn: () =>
      getAttributionChangeMovementFn({ data: { ...p, ...(page ?? NO_PAGE) } }),
    enabled: Boolean(page),
  });
