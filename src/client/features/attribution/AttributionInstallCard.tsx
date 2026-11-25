import { AttributionInstallCheck } from "./AttributionInstallCheck";
import { TagManagerInstall } from "./TagManagerInstall";
import { TrackerPlacement } from "./TrackerPlacement";
import { useState, type ReactNode } from "react";
import { Activity, CodeXml, Tags, Wrench } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { CardShell } from "@/client/components/CardShell";
import { CopyButton } from "@/client/components/CopyButton";
import { QueryState } from "@/client/components/QueryState";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/client/components/ui/accordion";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Skeleton } from "@/client/components/ui/skeleton";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  addAttributionPropertyFn,
  removeAttributionPropertyFn,
  rotateAttributionKeyFn,
} from "@/serverFunctions/attribution";
import { useAttributionSetup } from "./useAttributionSetup";

/** Websites, the tracker snippet, the test-event check and the server key. */
export function AttributionInstallCard({ projectId }: { projectId: string }) {
  const { query, refresh } = useAttributionSetup(projectId);
  const [host, setHost] = useState("");
  const [brandId, setBrandId] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [addingMore, setAddingMore] = useState(false);

  const add = useMutation({
    mutationFn: () =>
      addAttributionPropertyFn({
        data: {
          projectId,
          name: host.trim(),
          host: host.trim(),
          brandId: brandId || undefined,
        },
      }),
    onSuccess: async () => {
      setHost("");
      setAddingMore(false);
      await rotateAttributionKeyFn({
        data: { projectId, kind: "public" },
      }).catch(() => undefined);
      await refresh();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      removeAttributionPropertyFn({ data: { projectId, id } }),
    onSuccess: refresh,
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const rotate = useMutation({
    mutationFn: (kind: "public" | "secret") =>
      rotateAttributionKeyFn({ data: { projectId, kind } }),
    onSuccess: async (result, kind) => {
      if (kind === "secret") setSecret(result.key);
      await refresh();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  return (
    <CardShell title="Set up revenue attribution">
      <QueryState
        query={query}
        loading={<Skeleton className="h-40 w-full" />}
        errorFallback="Failed to load attribution setup"
      >
        {(setup) => (
          <div className="@container flex min-w-0 flex-col gap-5 text-sm">
            <p className="max-w-prose text-muted-foreground">
              Connect website visits to the signups, enquiries and payments you
              report to Caldrin.
            </p>

            <div className="grid items-start gap-5 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @3xl:gap-8">
              <section className="flex min-w-0 flex-col gap-2">
                <h3 className="font-medium">Websites</h3>
                {setup.properties.length ? (
                  <ul className="flex flex-col gap-1">
                    {setup.properties.map((p) => (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2"
                      >
                        <span className="font-medium">{p.host}</span>
                        {p.brandId ? (
                          <Badge variant="outline">
                            {setup.brands.find((b) => b.id === p.brandId)?.name}
                          </Badge>
                        ) : null}
                        {p.verifiedAt ? (
                          <Badge variant="success">
                            Receiving real traffic
                          </Badge>
                        ) : (
                          <Badge variant="warning">Nothing received yet</Badge>
                        )}
                        <Button
                          size="xs"
                          variant="ghost"
                          className="ml-auto"
                          onClick={() => remove.mutate(p.id)}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {setup.properties.length && !addingMore ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => setAddingMore(true)}
                  >
                    Add another website
                  </Button>
                ) : (
                  <form
                    className="flex flex-wrap gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (host.trim()) add.mutate();
                    }}
                  >
                    <Input
                      value={host}
                      onChange={(event) => setHost(event.target.value)}
                      placeholder="example.com"
                      aria-label="Website host"
                      className="max-w-xs"
                    />
                    {setup.brands.length ? (
                      <select
                        aria-label="Brand this website belongs to"
                        className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
                        value={brandId}
                        onChange={(event) => setBrandId(event.target.value)}
                      >
                        <option value="">No brand</option>
                        {setup.brands.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <Button
                      type="submit"
                      disabled={add.isPending || !host.trim()}
                    >
                      Add website
                    </Button>
                  </form>
                )}
              </section>

              <div className="min-w-0 space-y-4">
                <section className="space-y-2">
                  <div>
                    <h3 className="font-medium">Install the tracker</h3>
                    <p className="text-xs text-muted-foreground">
                      Choose one method per website. If you already import its
                      visits through PostHog, you can skip this.
                    </p>
                  </div>
                  <Accordion className="rounded-lg border border-border">
                    <InstallOption
                      value="tag-manager"
                      icon={<Tags className="size-4" aria-hidden />}
                      title="Google Tag Manager"
                      description="Use a container already installed on your site."
                    >
                      <TagManagerInstall
                        projectId={projectId}
                        properties={setup.properties}
                        hasSnippet={Boolean(setup.snippets.install)}
                      />
                    </InstallOption>
                    <InstallOption
                      value="snippet"
                      icon={<CodeXml className="size-4" aria-hidden />}
                      title="Manual snippet"
                      description="Add a short script to your website."
                    >
                      {setup.snippets.install ? (
                        <div className="space-y-3">
                          <TrackerPlacement platform={setup.sitePlatform} />
                          <pre className="overflow-auto rounded-md bg-muted/50 p-3 text-xs">
                            {setup.snippets.install}
                          </pre>
                          <CopyButton
                            value={setup.snippets.install}
                            label="Copy tracker snippet"
                            successMessage="Snippet copied"
                          />
                        </div>
                      ) : (
                        <p className="text-muted-foreground">
                          Add a website above to get its snippet.
                        </p>
                      )}
                    </InstallOption>
                  </Accordion>
                  <Accordion className="rounded-lg border border-border">
                    <InstallOption
                      value="verify"
                      icon={<Activity className="size-4" aria-hidden />}
                      title="Check installation"
                      description="Send a test event from your site after installing."
                    >
                      <AttributionInstallCheck projectId={projectId} />
                    </InstallOption>
                  </Accordion>
                </section>

                <Accordion className="border-t border-border">
                  <InstallOption
                    value="developer"
                    icon={<Wrench className="size-4" aria-hidden />}
                    title="Developer settings"
                    description={
                      setup.settings.consentMode === "required"
                        ? "Required consent setup, keys and server events."
                        : "Consent, keys and server events."
                    }
                  >
                    <div className="space-y-5">
                      <section className="space-y-2">
                        <h4 className="font-medium">Consent</h4>
                        <pre className="overflow-auto rounded-md bg-muted/50 p-3 text-xs">
                          {setup.snippets.consent}
                        </pre>
                        <p className="max-w-prose text-muted-foreground">
                          {setup.settings.consentMode === "required"
                            ? "The tracker waits for the consent call above before sending events."
                            : "The tracker starts sending events as soon as it loads."}{" "}
                          The tracker respects Do Not Track and Global Privacy
                          Control.
                        </p>
                        {setup.snippets.install && (
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={rotate.isPending}
                              onClick={() => rotate.mutate("public")}
                            >
                              Replace public key
                            </Button>
                            <span className="text-xs text-muted-foreground">
                              Update existing installs with the new key.
                            </span>
                          </div>
                        )}
                      </section>
                      <section className="space-y-2">
                        <h4 className="font-medium">Server events</h4>
                        <p className="max-w-prose text-muted-foreground">
                          Send signups, leads or payments from your backend to
                          credit the channel that first brought the visitor.
                        </p>
                        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                          <li>Create a key and store it as a server secret.</li>
                          <li>
                            At signup, send the <code>_cldr_vid</code> cookie as{" "}
                            <code>visitor_id</code> along with your{" "}
                            <code>user_id</code>.
                          </li>
                          <li>
                            Send later events with the same <code>user_id</code>
                            .
                          </li>
                        </ol>
                        <p className="text-muted-foreground">
                          Without a <code>visitor_id</code> or a known{" "}
                          <code>user_id</code>, the event is kept but its source
                          stays Unknown. The browser tracker cannot report
                          signups or user ids.
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={rotate.isPending}
                            onClick={() => rotate.mutate("secret")}
                          >
                            {setup.keys.some((k) => k.kind === "secret")
                              ? "Replace secret key"
                              : "Create secret key"}
                          </Button>
                          {setup.keys
                            .filter((k) => k.kind === "secret")
                            .map((k) => (
                              <span
                                key={k.prefix}
                                className="text-muted-foreground"
                              >
                                Current key starts {k.prefix}.{" "}
                                {k.lastUsedAt
                                  ? `Last used ${k.lastUsedAt.slice(0, 10)}.`
                                  : "Not used yet."}
                              </span>
                            ))}
                        </div>
                        {secret ? (
                          <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
                            <code className="break-all">{secret}</code>
                            <CopyButton
                              value={secret}
                              successMessage="Key copied"
                            />
                            <span className="text-xs text-muted-foreground">
                              Shown once. Store it as a server secret.
                            </span>
                          </div>
                        ) : null}
                        <pre className="overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
                          {setup.snippets.serverEvent}
                        </pre>
                      </section>
                    </div>
                  </InstallOption>
                </Accordion>
              </div>
            </div>
          </div>
        )}
      </QueryState>
    </CardShell>
  );
}

function InstallOption({
  value,
  icon,
  title,
  description,
  children,
}: {
  value: string;
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <AccordionItem value={value}>
      <AccordionTrigger className="items-center gap-3 px-3 py-3 hover:bg-muted/50 hover:no-underline">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block">{title}</span>
          <span className="block text-xs font-normal text-muted-foreground">
            {description}
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent keepMounted className="px-3 pt-2 pb-4 sm:px-5">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}
