import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Button } from "@/client/components/ui/button";
import {
  getStorePlatform,
  recheckStorePlatform,
  setShopifyOverride,
} from "@/serverFunctions/content";

export function storePlatformKey(projectId: string) {
  return ["store-platform", projectId];
}

/** Whether this project looks like a Shopify store, checked once on first use. */
export function useStorePlatform(projectId: string) {
  return useQuery({
    queryKey: storePlatformKey(projectId),
    queryFn: () => getStorePlatform({ data: { projectId } }),
    staleTime: Infinity,
  });
}

function detectionNote(
  status: NonNullable<ReturnType<typeof useStorePlatform>["data"]>,
) {
  if (!status.hasDomain) return "This project has no website set yet.";
  if (status.detection === "shopify")
    return `Shopify was detected on your site (${status.evidence}).`;
  if (status.detection === "not_shopify")
    return "No Shopify markers were found on your site's homepage.";
  return "Your site's homepage could not be read, so nothing was concluded.";
}

/**
 * Shopify cards are for Shopify stores. For any other project they sit behind
 * a collapsed link, with a re-check and a manual override for a headless or
 * custom-domain store whose homepage shows no marker.
 */
export function ShopifyPlatformGate({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const query = useStorePlatform(projectId);
  const [open, setOpen] = useState(
    () => typeof window !== "undefined" && window.location.hash === "#store",
  );
  const save = (status: unknown) =>
    queryClient.setQueryData(storePlatformKey(projectId), status);
  const recheck = useMutation({
    mutationFn: () => recheckStorePlatform({ data: { projectId } }),
    onSuccess: save,
  });
  const override = useMutation({
    mutationFn: () =>
      setShopifyOverride({ data: { projectId, enabled: true } }),
    onSuccess: save,
  });

  const status = query.data;
  if (!status) return null;
  if (status.visible) return <>{children}</>;

  return (
    <div className="space-y-4">
      <button
        type="button"
        aria-expanded={open}
        className="text-sm text-muted-foreground underline underline-offset-2"
        onClick={() => setOpen((value) => !value)}
      >
        Shopify store
      </button>
      {open ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 p-3">
            <p className="text-sm text-muted-foreground">
              {detectionNote(status)} These settings are only needed for a
              Shopify store.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={recheck.isPending}
                onClick={() => recheck.mutate()}
              >
                {recheck.isPending ? "Checking…" : "Re-check"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={override.isPending}
                onClick={() => override.mutate()}
              >
                This is a Shopify store
              </Button>
            </div>
          </div>
          {children}
        </>
      ) : null}
    </div>
  );
}
