import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Switch } from "@/client/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import {
  connectShopifyStore,
  connectSimulatedShopify,
  disconnectShopifyStore,
  getShopifyBlogs,
  setShopifyAutoPublish,
  setShopifyBlog,
  startShopifyOAuth,
  type ContentResult,
} from "@/serverFunctions/content";
import { unwrap } from "./helpers";

export function ConnectionCard({
  projectId,
  connection,
  oauthConfigured,
  onChange,
}: {
  projectId: string;
  oauthConfigured: boolean;
  connection: {
    shopDomain: string;
    mode: string;
    isDevelopmentStore: boolean;
    canPublish: boolean;
    blogId: string | null;
    autoPublish: boolean;
    autoPublishAllowed: boolean;
  } | null;
  onChange: () => void;
}) {
  const [shopDomain, setShopDomain] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [useToken, setUseToken] = useState(false);
  const done = (result: ContentResult<unknown>) => {
    if (unwrap(result)) onChange();
  };
  const demo = useMutation({
    mutationFn: () => connectSimulatedShopify({ data: { projectId } }),
    onSuccess: done,
  });
  const live = useMutation({
    mutationFn: () =>
      connectShopifyStore({ data: { projectId, shopDomain, accessToken } }),
    onSuccess: (result) => {
      done(result);
      setAccessToken("");
    },
  });
  const connectOAuth = useMutation({
    mutationFn: () =>
      startShopifyOAuth({ data: { projectId, shop: shopDomain } }),
    onSuccess: (result) => {
      const started = unwrap(result);
      if (started) window.location.assign(started.authorizeUrl);
    },
  });
  const disconnect = useMutation({
    mutationFn: () => disconnectShopifyStore({ data: { projectId } }),
    onSuccess: (result) => {
      // The local token is always gone; the note says whether Shopify
      // confirmed the revocation.
      if (result.revoked) toast.success(result.note);
      else toast.warning(result.note);
      onChange();
    },
  });

  const blogs = useQuery({
    queryKey: ["shopify-blogs", projectId],
    queryFn: () => getShopifyBlogs({ data: { projectId } }),
    enabled: Boolean(connection?.canPublish),
  });
  const chooseBlog = useMutation({
    mutationFn: (blogId: string | null) =>
      setShopifyBlog({ data: { projectId, blogId } }),
    onSuccess: (result) => {
      if (unwrap(result)) onChange();
    },
  });
  const autoPublish = useMutation({
    mutationFn: (enabled: boolean) =>
      setShopifyAutoPublish({ data: { projectId, enabled } }),
    onSuccess: (result) => {
      if (unwrap(result)) onChange();
    },
  });
  const blogItems =
    blogs.data?.ok && blogs.data.data.length > 1
      ? [
          { value: "default", label: "Default blog" },
          ...blogs.data.data.map((b) => ({ value: b.id, label: b.title })),
        ]
      : [];

  if (connection) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <div className="space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {connection.shopDomain}
            {connection.mode === "simulated" ? (
              <Badge variant="info">Demo</Badge>
            ) : connection.isDevelopmentStore ? (
              <Badge variant="info">Development store</Badge>
            ) : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {connection.mode === "simulated"
              ? "Demo store: sample products and sample search data. Nothing leaves Caldrin."
              : connection.canPublish
                ? "Connected to Shopify with permission to create articles."
                : "Connected read-only. Grant write_content to publish."}
          </p>
        </div>
        {blogItems.length > 0 ? (
          <Select
            items={blogItems}
            value={connection.blogId ?? "default"}
            onValueChange={(value) =>
              chooseBlog.mutate(value === "default" ? null : value)
            }
          >
            <SelectTrigger
              size="sm"
              aria-label="Blog for new articles"
              title="New articles are created in this blog"
              className="text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {blogItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          pending={disconnect.isPending}
          onClick={() => disconnect.mutate()}
        >
          Disconnect
        </Button>
        {connection.mode === "live" && connection.canPublish ? (
          <div className="flex basis-full items-center justify-between gap-4 border-t pt-3 text-sm">
            <div>
              <p className="font-medium">Auto-publish approved drafts</p>
              <p className="text-xs text-muted-foreground">
                {connection.autoPublishAllowed || connection.autoPublish
                  ? "Approving a draft also creates it in the store and publishes it. Every step is still recorded in the change log."
                  : "Off. Publish one article through the approval steps first; this can be turned on after that."}
              </p>
            </div>
            <Switch
              aria-label="Auto-publish approved drafts"
              checked={connection.autoPublish}
              disabled={
                autoPublish.isPending ||
                (!connection.autoPublish && !connection.autoPublishAllowed)
              }
              onCheckedChange={(enabled) => autoPublish.mutate(enabled)}
            />
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Connect a store</h2>
        <p className="text-xs text-muted-foreground">
          Try the demo first, or connect a store. Articles are created as drafts
          until you publish them.
        </p>
      </div>
      {oauthConfigured ? (
        <form
          className="grid gap-2 md:grid-cols-[1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            connectOAuth.mutate();
          }}
        >
          <Input
            aria-label="Shop domain"
            placeholder="your-store.myshopify.com"
            value={shopDomain}
            onChange={(event) => setShopDomain(event.target.value)}
          />
          <Button
            type="submit"
            pending={connectOAuth.isPending}
            disabled={shopDomain.length < 3}
          >
            Connect Shopify
          </Button>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">
          Shopify app credentials are not configured on this deployment.
        </p>
      )}
      {useToken ? (
        <form
          className="grid gap-2 md:grid-cols-[1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            live.mutate();
          }}
        >
          <Input
            aria-label="Shop domain for a custom app token"
            placeholder="your-store.myshopify.com"
            value={shopDomain}
            onChange={(event) => setShopDomain(event.target.value)}
          />
          <Input
            type="password"
            autoComplete="off"
            aria-label="Admin API token"
            placeholder="Admin API access token (read_products, read_content, write_content)"
            value={accessToken}
            onChange={(event) => setAccessToken(event.target.value)}
          />
          <Button
            type="submit"
            pending={live.isPending}
            disabled={!shopDomain || accessToken.length < 10}
          >
            Connect
          </Button>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          pending={demo.isPending}
          onClick={() => demo.mutate()}
        >
          Try with a demo store
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setUseToken(!useToken)}
        >
          {useToken
            ? "Hide custom app token"
            : "Use a custom app token instead"}
        </Button>
      </div>
    </div>
  );
}
