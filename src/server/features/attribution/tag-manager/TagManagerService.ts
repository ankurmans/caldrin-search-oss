import {
  tagManagerGrant,
  disconnectTagManagerGrant,
  tagManagerPortForUser,
} from "./tagManagerGrant";
import { captureServerEvent } from "@/server/lib/posthog";
import { runAfterResponse } from "@/server/lib/background";
import { z } from "zod";
import { LedgerService } from "@/server/features/ledger/services/LedgerService";
import {
  LedgerRefusal,
  type LedgerEntry,
  type LedgerScope,
} from "@/server/features/ledger/types";
import { buildCacheKey } from "@/server/lib/r2-cache";
import { getAttributionSetup } from "../services/attributionSetup";
import { containerPathSchema, type TagManagerPort } from "./TagManagerPort";

const provider = "google_tag_manager" as const;
const planSchema = z.object({
  containerPath: containerPathSchema,
  containerName: z.string(),
  containerId: z.string(),
  accountId: z.string(),
  hostname: z.string(),
  snippetHash: z.string(),
});
const draftSchema = z
  .object({
    workspace: z.string(),
    tagId: z.string(),
    tagName: z.string(),
    triggerId: z.string(),
  })
  .merge(planSchema);

function tagHtml(
  origin: string,
  key: string,
  hostname: string,
  consent: string,
) {
  // A shared GTM container can run on several sites. The tag installs only on
  // this registered host, and the tracker still applies its own consent handling.
  return [
    "<script>",
    "(function () {",
    "var host = " + JSON.stringify(hostname) + ";",
    "if (location.hostname !== host && location.hostname !== 'www.' + host) return;",
    "var script = document.createElement('script');",
    "script.async = true;",
    "script.src = " + JSON.stringify(origin + "/t.js") + ";",
    "script.setAttribute('data-key', " + JSON.stringify(key) + ");",
    "script.setAttribute('data-consent', " + JSON.stringify(consent) + ");",
    "document.head.appendChild(script);",
    "})();",
    "</script>",
  ].join("\n");
}

async function prepareTag(projectId: string, origin: string, hostname: string) {
  const setup = await getAttributionSetup(projectId);
  if (
    !setup.publicKey ||
    !setup.properties.some((item) => item.host === hostname)
  )
    throw new LedgerRefusal(
      "Add this website in Attribution and generate its public tracker key first.",
    );
  const html = tagHtml(
    origin,
    setup.publicKey,
    hostname,
    setup.settings.consentMode,
  );
  return { html, snippetHash: await buildCacheKey("gtm-install", { html }) };
}

function matchesTag(
  tag: Awaited<ReturnType<TagManagerPort["tag"]>>,
  draft: z.infer<typeof draftSchema>,
  html: string,
) {
  return (
    tag?.tagId === draft.tagId &&
    tag.name === draft.tagName &&
    tag.type === "html" &&
    tag.firingTriggerId?.includes(draft.triggerId) &&
    tag.parameter?.some((field) => field.key === "html" && field.value === html)
  );
}

async function currentPlan(scope: LedgerScope, entryId: string) {
  const { entry } = await LedgerService.getEntry(scope.projectId, entryId);
  if (
    entry.provider !== provider ||
    entry.organizationId !== scope.organizationId
  )
    throw new LedgerRefusal(
      "This change is not a tracker installation for this project.",
    );
  return {
    entry,
    plan: planSchema.parse(JSON.parse(entry.afterState ?? "{}")),
  };
}

function view(entry: LedgerEntry) {
  const plan = planSchema.parse(JSON.parse(entry.afterState ?? "{}"));
  const workspace = entry.rollbackPayload
    ? draftSchema.safeParse(JSON.parse(entry.rollbackPayload))
    : null;
  return {
    id: entry.id,
    status: entry.status,
    publication: entry.publicationStatus,
    action: entry.proposedAction,
    error: entry.error,
    hostname: plan.hostname,
    containerName: plan.containerName,
    containerId: plan.containerId,
    containerUrl:
      "https://tagmanager.google.com/#/container/" +
      (workspace?.success ? workspace.data.workspace : plan.containerPath),
    lastUse: entry.updatedAt,
  };
}

async function status(scope: LedgerScope) {
  const [accountId, entries] = await Promise.all([
    tagManagerGrant(scope.userId),
    LedgerService.listEntries(scope.projectId, { provider, limit: 5 }),
  ]);
  return { connected: accountId !== null, entries: entries.map(view) };
}

async function propose(
  scope: LedgerScope,
  origin: string,
  path: string,
  hostname: string,
) {
  const accountId = await tagManagerGrant(scope.userId);
  if (!accountId)
    throw new LedgerRefusal("Connect your Google Tag Manager account first.");
  const api = await tagManagerPortForUser(scope.userId, accountId);
  const { snippetHash } = await prepareTag(scope.projectId, origin, hostname);
  const [container, live] = await Promise.all([
    api.container(path),
    api.live(path),
  ]);
  if (!container?.usageContext?.includes("web"))
    throw new LedgerRefusal(
      "Choose a web container you can access in Google Tag Manager.",
    );
  if (
    container.domainName?.length &&
    !container.domainName.some(
      (domain) =>
        domain.toLowerCase().replace(/^www\./, "") ===
        hostname.replace(/^www\./, ""),
    )
  )
    throw new LedgerRefusal(
      "The container lists other domains. Choose the web container for this website.",
    );
  if (
    live?.tag?.some((tag) =>
      tag.name.startsWith("Caldrin Search tracker · " + hostname + " · "),
    )
  )
    throw new LedgerRefusal(
      "A tracker tag for this site is already present in the live container.",
    );
  const plan = planSchema.parse({
    containerPath: path,
    containerName: container.name,
    containerId: container.publicId,
    accountId,
    hostname,
    snippetHash,
  });
  const entry = await LedgerService.proposeChange(scope, {
    kind: "technical_fix",
    provider,
    targetUrl: "https://" + hostname,
    proposedAction:
      "Add a tracker tag for " +
      hostname +
      " to a separate workspace in " +
      container.name +
      ". Review and publish the workspace in Tag Manager when ready.",
    beforeState: live
      ? "Live container version " + live.containerVersionId
      : "No published container version",
    afterState: JSON.stringify(plan),
    idempotencyKey: await buildCacheKey("gtm-install-plan", {
      ...plan,
      projectId: scope.projectId,
      live: live?.containerVersionId ?? null,
    }),
  });
  return view(entry);
}

async function stage(scope: LedgerScope, origin: string, entryId: string) {
  const { entry, plan } = await currentPlan(scope, entryId);
  if (entry.status !== "proposed" && entry.status !== "approved")
    throw new LedgerRefusal(
      "Only a proposed or approved tracker change can be staged.",
    );
  const { html, snippetHash } = await prepareTag(
    scope.projectId,
    origin,
    plan.hostname,
  );
  if (snippetHash !== plan.snippetHash)
    throw new LedgerRefusal("Tracker settings changed. Review a fresh plan.");
  const api = await tagManagerPortForUser(scope.userId, plan.accountId);
  const live = await api.live(plan.containerPath);
  const liveLabel = live
    ? "Live container version " + live.containerVersionId
    : "No published container version";
  if (liveLabel !== entry.beforeState)
    throw new LedgerRefusal(
      "The published container version changed. Review a fresh plan.",
    );
  if (entry.status === "proposed")
    await LedgerService.approveChange(scope, entryId);
  await LedgerService.beginExecution(scope, entryId);

  const name =
    "Caldrin Search tracker · " + plan.hostname + " · " + entry.id.slice(0, 8);
  try {
    const workspace = await api.createWorkspace(plan.containerPath, name);
    if (!workspace?.path.startsWith(plan.containerPath + "/workspaces/"))
      throw new LedgerRefusal("Tag Manager did not return the new workspace.");
    const trigger = await api.createPageTrigger(workspace.path, name);
    if (!trigger)
      throw new LedgerRefusal(
        "Tag Manager did not return the page-view trigger.",
      );
    const tag = await api.createTag(
      workspace.path,
      name,
      trigger.triggerId,
      html,
    );
    if (!tag)
      throw new LedgerRefusal("Tag Manager did not return the tracker tag.");
    const draft = {
      ...plan,
      workspace: workspace.path,
      triggerId: trigger.triggerId,
      tagId: tag.tagId,
      tagName: name,
    };
    if (!matchesTag(await api.tag(workspace.path, tag.tagId), draft, html))
      throw new LedgerRefusal(
        "The tracker tag could not be verified in the new workspace.",
      );
    return view(
      await LedgerService.recordExecution(scope, entryId, {
        externalId: tag.tagId,
        publicationStatus: "draft",
        rollback: { kind: "manual", payload: JSON.stringify(draft) },
      }),
    );
  } catch (error) {
    await LedgerService.recordFailure(
      scope,
      entryId,
      "The workspace draft could not be verified. Check Tag Manager for the workspace named " +
        name +
        ".",
    );
    throw error;
  }
}

async function verify(scope: LedgerScope, origin: string, entryId: string) {
  const { entry, plan } = await currentPlan(scope, entryId);
  if (entry.status !== "executed")
    throw new LedgerRefusal("Stage the approved tracker change first.");
  const draft = draftSchema.parse(JSON.parse(entry.rollbackPayload ?? "{}"));
  const { html, snippetHash } = await prepareTag(
    scope.projectId,
    origin,
    plan.hostname,
  );
  const api = await tagManagerPortForUser(scope.userId, plan.accountId);
  const live = await api.live(plan.containerPath);
  if (
    snippetHash !== plan.snippetHash ||
    !live?.tag?.some((tag) => matchesTag(tag, draft, html))
  ) {
    return { published: false, entry: view(entry) };
  }
  if (entry.publicationStatus === "published")
    return { published: true, entry: view(entry) };
  const verified = await LedgerService.recordVerifiedPublication(
    scope,
    entryId,
  );
  await runAfterResponse(
    captureServerEvent({
      distinctId: scope.userId,
      organizationId: scope.organizationId,
      event: "onboarding:connector_installed",
      properties: {
        project_id: scope.projectId,
        platform: "google_tag_manager",
      },
    }),
  );
  return { published: true, entry: view(verified) };
}

async function rollback(scope: LedgerScope, entryId: string) {
  const { entry, plan } = await currentPlan(scope, entryId);
  const { payload } = await LedgerService.beginRollback(scope, entryId);
  const draft = draftSchema.parse(JSON.parse(payload));
  const api = await tagManagerPortForUser(scope.userId, plan.accountId);
  const live = await api.live(plan.containerPath);
  if (
    live?.tag?.some(
      (tag) => tag.tagId === draft.tagId || tag.name === draft.tagName,
    )
  )
    throw new LedgerRefusal(
      "The tag is live. Remove it in Tag Manager and publish that change, then verify the removal here.",
    );
  if (entry.publicationStatus === "draft") {
    const tag = await api.tag(draft.workspace, draft.tagId);
    if (tag) {
      const html = tag.parameter?.find((param) => param.key === "html")?.value;
      if (
        tag.name !== draft.tagName ||
        !html ||
        (await buildCacheKey("gtm-install", { html })) !== plan.snippetHash
      )
        throw new LedgerRefusal(
          "The workspace tag changed. Review it in Tag Manager.",
        );
    }
    if (tag) await api.deleteTag(draft.workspace, draft.tagId);
    // Leave the trigger in place if anyone else may reference it.
    if (await api.tag(draft.workspace, draft.tagId))
      throw new LedgerRefusal(
        "Tag Manager did not confirm that the draft tag was removed.",
      );
  }
  return view(await LedgerService.recordRollback(scope, entryId));
}

export const TagManagerService = {
  status,
  disconnect: disconnectTagManagerGrant,
  propose,
  stage,
  verify,
  rollback,
};
