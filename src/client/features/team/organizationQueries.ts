import { queryOptions } from "@tanstack/react-query";
import { getOrganizationContext } from "@/serverFunctions/organization";

export const organizationContextQueryOptions = () =>
  queryOptions({
    queryKey: ["organization-context"],
    queryFn: () => getOrganizationContext(),
    staleTime: 60 * 1000,
  });
