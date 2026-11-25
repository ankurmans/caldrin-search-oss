import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { SectionHeader } from "@/client/components/PageHeader";
import { QueryError } from "@/client/components/QueryState";
import { SkeletonCard } from "@/client/components/SkeletonPresets";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Switch } from "@/client/components/ui/switch";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  clearWorkspaceBranding,
  getWorkspaceBranding,
  saveWorkspaceBranding,
} from "@/serverFunctions/branding";

const QUERY_KEY = ["workspace-branding"];

type Branding = {
  brandName: string;
  logoUrl: string | null;
  accentColor: string | null;
  hideAttribution: boolean;
};

export function BrandingSettings() {
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getWorkspaceBranding(),
  });
  if (query.isPending) return <SkeletonCard />;
  if (query.isError)
    return (
      <QueryError error={query.error} fallback="Failed to load branding" />
    );
  // Members who cannot manage the workspace see nothing to change.
  if (!query.data.canManage) return null;
  const { branding, platform } = query.data;
  if (!platform.canBrand) {
    return (
      <section className="space-y-3">
        <SectionHeader title="Report branding" />
        <p className="text-sm text-muted-foreground">
          Brand shared report links and PDF exports with Agency.{" "}
          <Link to="/settings/billing" className="underline">
            See the Agency plan
          </Link>
          .
        </p>
      </section>
    );
  }
  return (
    <BrandingForm saved={branding} graceEndsAt={platform.brandingGraceEndsAt} />
  );
}

function BrandingForm({
  saved,
  graceEndsAt,
}: {
  saved: Branding | null;
  graceEndsAt: string | null;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    brandName: saved?.brandName ?? "",
    logoUrl: saved?.logoUrl ?? "",
    accentColor: saved?.accentColor ?? "",
    hideAttribution: saved?.hideAttribution ?? false,
  });
  const done = (message: string) => {
    toast.success(message);
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  };
  const onError = (error: unknown) =>
    toast.error(getStandardErrorMessage(error));
  const save = useMutation({
    mutationFn: () =>
      saveWorkspaceBranding({
        data: {
          brandName: form.brandName,
          logoUrl: form.logoUrl || null,
          accentColor: form.accentColor || null,
          hideAttribution: form.hideAttribution,
        },
      }),
    onSuccess: () => done("Branding saved"),
    onError,
  });
  const clear = useMutation({
    mutationFn: () => clearWorkspaceBranding(),
    onSuccess: () => {
      setForm({
        brandName: "",
        logoUrl: "",
        accentColor: "",
        hideAttribution: false,
      });
      done("Branding removed");
    },
    onError,
  });
  const set = (key: keyof typeof form) => (value: string | boolean) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Report branding"
        hint="Shared links use your name, logo and accent color. PDF exports use your name and accent color."
      />
      {graceEndsAt ? (
        <p className="text-sm text-muted-foreground">
          Your existing branding is active through {graceEndsAt.slice(0, 10)}.{" "}
          <Link to="/settings/billing" className="underline">
            See the Agency plan
          </Link>
          .
        </p>
      ) : null}
      <form
        className="space-y-3 rounded-md border p-4 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          if (form.brandName.trim()) save.mutate();
        }}
      >
        <label className="block space-y-1">
          <span className="font-medium">Name</span>
          <Input
            value={form.brandName}
            maxLength={60}
            placeholder="Acme Agency"
            onChange={(event) => set("brandName")(event.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="font-medium">Logo address (optional)</span>
          <Input
            value={form.logoUrl}
            maxLength={500}
            placeholder="https://example.com/logo.png"
            onChange={(event) => set("logoUrl")(event.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="font-medium">Accent color (optional)</span>
          <Input
            value={form.accentColor}
            maxLength={7}
            placeholder="#1a73e8"
            onChange={(event) => set("accentColor")(event.target.value)}
          />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block font-medium">Hide Caldrin Search</span>
            <span className="text-muted-foreground">
              Removes the "Made with" line from shared links and the PDF header.
              Shared links also hide the try-it button.
            </span>
          </span>
          <Switch
            checked={form.hideAttribution}
            onCheckedChange={set("hideAttribution")}
          />
        </label>
        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={save.isPending || !form.brandName.trim()}
          >
            Save
          </Button>
          {saved ? (
            <Button
              type="button"
              variant="outline"
              disabled={clear.isPending}
              onClick={() => clear.mutate()}
            >
              Remove branding
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
