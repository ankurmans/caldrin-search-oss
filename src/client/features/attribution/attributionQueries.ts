import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  getAttributionCallsFn,
  getAttributionLeadsFn,
  getAttributionRoutingFn,
} from "@/serverFunctions/attributionLeads";
import {
  compareAttributionModelsFn,
  getAttributionHealthFn,
  getAttributionOverviewFn,
  getConversionEvidenceFn,
  listAttributionConnectorsFn,
  listAttributionJourneysFn,
} from "@/serverFunctions/attributionReports";
import type { RangeKey } from "@/shared/attribution/ranges";
import type { ModelKey } from "@/shared/attribution/vocabulary";
import { attributionKey } from "./useAttributionSetup";

export type ReportParams = {
  projectId: string;
  range: RangeKey;
  model?: ModelKey;
  demo: boolean;
  /** Only enquiries received by, or meant for, this brand. */
  brandId?: string;
};

export const useAttributionOverview = (p: ReportParams) =>
  useQuery({
    queryKey: attributionKey(
      p.projectId,
      "overview",
      p.range,
      p.model,
      p.demo,
      p.brandId,
    ),
    queryFn: () => getAttributionOverviewFn({ data: p }),
    placeholderData: keepPreviousData,
  });

export const useModelComparison = (p: ReportParams, kind: string) =>
  useQuery({
    queryKey: attributionKey(
      p.projectId,
      "compare",
      kind,
      p.range,
      p.demo,
      p.brandId,
    ),
    queryFn: () => compareAttributionModelsFn({ data: { ...p, kind } }),
    placeholderData: keepPreviousData,
  });

export const useJourneys = (p: ReportParams, kinds: string[] | undefined) =>
  useQuery({
    queryKey: attributionKey(
      p.projectId,
      "journeys",
      p.range,
      p.model,
      p.demo,
      p.brandId,
      kinds,
    ),
    queryFn: () => listAttributionJourneysFn({ data: { ...p, kinds } }),
    placeholderData: keepPreviousData,
  });

export const useConversionEvidence = (
  projectId: string,
  conversionId: string | undefined,
) =>
  useQuery({
    queryKey: attributionKey(projectId, "evidence", conversionId),
    queryFn: () =>
      getConversionEvidenceFn({
        data: { projectId, conversionId: conversionId ?? "" },
      }),
    enabled: Boolean(conversionId),
  });

export const useAttributionHealth = (projectId: string, demo: boolean) =>
  useQuery({
    queryKey: attributionKey(projectId, "health", demo),
    queryFn: () => getAttributionHealthFn({ data: { projectId, demo } }),
  });

export const useAttributionConnectors = (projectId: string) =>
  useQuery({
    queryKey: attributionKey(projectId, "connectors"),
    queryFn: () => listAttributionConnectorsFn({ data: { projectId } }),
  });

export const useLeadsReport = (p: ReportParams) =>
  useQuery({
    queryKey: attributionKey(
      p.projectId,
      "leads",
      p.range,
      p.model,
      p.demo,
      p.brandId,
    ),
    queryFn: () => getAttributionLeadsFn({ data: p }),
    placeholderData: keepPreviousData,
  });

export const useRoutingReport = (p: ReportParams) =>
  useQuery({
    queryKey: attributionKey(
      p.projectId,
      "routing",
      p.range,
      p.demo,
      p.brandId,
    ),
    queryFn: () => getAttributionRoutingFn({ data: p }),
    placeholderData: keepPreviousData,
  });

export const useCallsReport = (p: ReportParams) =>
  useQuery({
    queryKey: attributionKey(
      p.projectId,
      "calls",
      p.range,
      p.model,
      p.demo,
      p.brandId,
    ),
    queryFn: () => getAttributionCallsFn({ data: p }),
    placeholderData: keepPreviousData,
  });
