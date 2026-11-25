import { canAccessProject, isClientGuest } from "@/lib/org-permissions";
import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { routeAgentRequest } from "agents";
import { resolveUserContextFromHeaders } from "@/middleware/ensure-user/resolve";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { SamSessionRepository } from "@/server/features/sam/SamSessionRepository";
import { runScheduledRankChecks } from "@/server/features/rank-tracking/services/scheduledRankChecks";
import { reconcileStaleAudits } from "@/server/features/audit/services/auditReconciler";
import {
  getAuthMode,
  setRuntimeAuthMode,
  usesBetterAuth,
} from "@/lib/auth-mode";
import {
  createCaldrinSearchOAuthProvider,
  type CaldrinSearchOAuthEnv,
} from "@/server/mcp/oauth-provider";
import { requestWithPublicOrigin } from "@/server/mcp/public-origin";
import { MCP_ROUTE } from "@/server/mcp/context";
import { withPgClient } from "@/db";
import { withDataforseoSlots } from "@/server/lib/dataforseo/request-slots";
import { isByokPreview } from "@/lib/byok-preview";

const startHandler = createStartHandler(defaultStreamHandler);

// The app ships no security response headers of its own, so any third-party
// page can frame an app route and UI-redress a one-click action (delete a
// project, change project settings). `frame-ancestors 'self'` on
// the app's own documents is the whole fix, and deliberately all of it: a
// script-src policy would need a nonce for the inline bootstrap script in
// __root.tsx plus allowances for Turnstile and PostHog, which is separate,
// larger work.
//
// Only HTML documents, and only ones that carry no policy of their own, so a
// route that sets its own stricter CSP keeps it (two CSP headers intersect, so
// adding a second could only confuse things). Wrapping the handler rather than
// one call site covers the OAuth-provider path too, which serves app documents
// through this same function.
async function appFetch(request: Request): Promise<Response> {
  const response = await startHandler(request);
  const contentType = response.headers.get("content-type") ?? "";
  if (
    !contentType.startsWith("text/html") ||
    response.headers.has("content-security-policy")
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", "frame-ancestors 'self'");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const caldrinSearchOAuthProvider = createCaldrinSearchOAuthProvider(appFetch);

// Authorize a SAM agent connection in the Worker, before it reaches the Durable
// Object. The DO instance name is the sessionId (set client-side); we resolve
// the session here and authorize the caller against the session's project via
// the same canonical project-access check the rest of the app uses, so the DO
// can trust its `name` and derive org/project/user from the session row.
// Returning a Response rejects; void lets it through.
async function authorizeSamChat(
  request: Request,
  sessionId: string,
): Promise<Response | undefined> {
  let context;
  try {
    context = await resolveUserContextFromHeaders(request.headers);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  if (isClientGuest(context.role))
    return new Response("Forbidden", { status: 403 });
  const session = await SamSessionRepository.getActiveSession(
    sessionId,
    context.userId,
  );
  const project =
    session && canAccessProject(context.allowedProjectIds, session.projectId)
      ? await ProjectRepository.getProjectForOrganization(
          session.projectId,
          context.organizationId,
        )
      : null;
  if (!session || !project) {
    return new Response("Forbidden", { status: 403 });
  }
  return undefined;
}

// The chat DO lives behind /agents/*. Dispatch on the DO binding partyserver
// resolved for the request (rather than re-parsing the path), and fail closed
// on anything unrecognized.
function authorizeChatAgent(
  request: Request,
  lobby: { className: string; name: string },
): Promise<Response | undefined> | Response {
  if (lobby.className === "SAM_CHAT") {
    return authorizeSamChat(request, lobby.name);
  }
  return new Response("Forbidden", { status: 403 });
}

// Route /agents/* to the SAM chat DO. Auth happens here (both the WS upgrade
// and any HTTP message-history fetch), keeping it off the OAuth wrapper and
// TanStack route guard below.
async function routeChatAgents(request: Request, env: Env): Promise<Response> {
  const response = await routeAgentRequest(request, env, {
    onBeforeConnect: (req, lobby) => authorizeChatAgent(req, lobby),
    onBeforeRequest: (req, lobby) => authorizeChatAgent(req, lobby),
  });
  return response ?? new Response("Not found", { status: 404 });
}

function fetch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // Scope a per-request Postgres client (no-op in D1 mode). The client isn't
  // closed here — the Workers↔Hyperdrive socket is reclaimed at invocation end.
  // The DataForSEO cap is per request too, matching the connection limit.
  return withPgClient(() =>
    withDataforseoSlots(() => handleAppRequest(request, env, ctx)),
  );
}

async function handleAppRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // The internal dashboard's hostname serves only the dashboard.
  if (!isByokPreview) {
    const { isAdminRequest, handleAdminRequest } =
      await import("@/server/admin-dashboard/handler");
    if (isAdminRequest(request)) return handleAdminRequest(request);
  }

  const authMode = getAuthMode(env.AUTH_MODE);
  setRuntimeAuthMode(env.AUTH_MODE);
  const publicRequest = requestWithPublicOrigin(request);
  const pathname = new URL(publicRequest.url).pathname;

  // Operator account commands (`pnpm selfhost:admin`). The handler answers 404
  // without the operator secret; the check is also what avoids a KV read per
  // request.
  if (!isByokPreview && pathname === "/api/standalone/admin") {
    const { hasOperatorSecret } =
      await import("@/server/standalone/operator-auth");
    if (hasOperatorSecret()) {
      const { handleOperatorRequest } =
        await import("@/server/standalone/admin");
      return handleOperatorRequest(publicRequest);
    }
  }

  if (pathname === "/api/ai-visibility/download") {
    return import("@/server/features/ai-visibility/services/aiVisibilityExport").then(
      ({ handleAiVisibilityDownload }) =>
        handleAiVisibilityDownload(publicRequest),
    );
  }

  // Visits sent by a customer's Worker snippet; authenticated by its own key.
  if (pathname === "/api/crawler-events") {
    return import("@/server/api/crawlerEvents").then(({ handleCrawlerEvent }) =>
      handleCrawlerEvent(publicRequest),
    );
  }

  // Access logs and log-drain batches, with the same key.
  if (pathname === "/api/crawler-logs") {
    return import("@/server/api/crawlerLogs").then(({ handleCrawlerLog }) =>
      handleCrawlerLog(publicRequest),
    );
  }

  // Revenue attribution: the tracker snippet, its collector (a public key in
  // the body), and the backend event API (a secret key as a Bearer token).
  if (pathname === "/t.js") {
    return import("@/server/api/attributionTracker").then(
      ({ handleAttributionTracker }) => handleAttributionTracker(publicRequest),
    );
  }
  if (pathname === "/api/attribution/collect") {
    return import("@/server/api/attributionCollect").then(
      ({ handleAttributionCollect }) => handleAttributionCollect(publicRequest),
    );
  }
  if (pathname === "/api/attribution/events") {
    return import("@/server/api/attributionEvents").then(
      ({ handleAttributionEvents }) => handleAttributionEvents(publicRequest),
    );
  }
  const adapterRoute = pathname.match(/^\/api\/attribution\/(crm|calls)$/);
  if (adapterRoute) {
    const kind = adapterRoute[1] === "crm" ? "crm" : "calls";
    return import("@/server/api/attributionAdapters").then(
      ({ handleAttributionAdapter }) =>
        handleAttributionAdapter(publicRequest, kind),
    );
  }
  const paymentHook = pathname.match(
    /^\/api\/attribution\/webhooks\/(stripe|polar)\/([A-Za-z0-9-]{8,64})$/,
  );
  if (paymentHook) {
    const kind = paymentHook[1] === "polar" ? "polar" : "stripe";
    return import("@/server/api/attributionWebhook").then(
      ({ handleAttributionWebhook }) =>
        handleAttributionWebhook(publicRequest, kind, paymentHook[2] ?? ""),
    );
  }

  if (pathname.startsWith("/api/v1/") || pathname === "/api/v1") {
    // API keys exist only where the app has its own accounts.
    if (!usesBetterAuth(authMode))
      return new Response("Not found", { status: 404 });
    return import("@/server/api/restApi").then(({ handleRestApiRequest }) =>
      handleRestApiRequest(publicRequest, env),
    );
  }

  if (pathname.startsWith("/agents/")) {
    return routeChatAgents(publicRequest, env);
  }

  if (usesBetterAuth(authMode)) {
    return caldrinSearchOAuthProvider.fetch(
      publicRequest,
      env as CaldrinSearchOAuthEnv,
      ctx,
    );
  }

  if (
    (authMode === "cloudflare_access" || authMode === "local_noauth") &&
    pathname === MCP_ROUTE
  ) {
    return import("@/server/mcp/transport").then(
      ({ handleSelfHostedCaldrinSearchMcpRequest }) =>
        handleSelfHostedCaldrinSearchMcpRequest(
          publicRequest,
          authMode,
          env,
          ctx,
        ),
    );
  }

  return appFetch(request);
}

// Export Workflow classes as named exports. SiteAuditWorkflow and the
// AuditScratchpad DO live in the caldrin-search-audit aux worker
// (src/audit-worker.ts); this worker reaches them via cross-script bindings.
export { RankCheckWorkflow } from "./server/workflows/RankCheckWorkflow";
export { AiVisibilityWorkflow } from "./server/workflows/AiVisibilityWorkflow";
export { LocalRankWorkflow } from "./server/workflows/LocalRankWorkflow";
// Durable Object class for the SAM in-app agent (Agents SDK).
export { SamChatAgent } from "./server/features/sam/SamChatAgent";

// Daily OAuth KV garbage collection; must match a trigger in wrangler.jsonc.
const MCP_OAUTH_PURGE_CRON = "17 3 * * *";

export default {
  fetch,
  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ) {
    if (controller.cron === MCP_OAUTH_PURGE_CRON) {
      try {
        const { claimRepository } =
          await import("@/server/features/ai-claims/claimRepository");
        await withPgClient(() =>
          claimRepository.pruneSnapshots(
            new Date(controller.scheduledTime - 180 * 86_400_000).toISOString(),
          ),
        );
      } catch {
        console.error("[cron] Claim evidence retention failed");
      }
      // Daily performance loop, in every auth mode: reconcile stuck Shopify
      // executions and take due Search Console / Analytics follow-up readings.
      // It acts as the system, calls no paid API and writes nothing to Shopify.
      try {
        const { runScheduledLedgerJobs } =
          await import("@/server/features/ledger/services/scheduledLedgerJobs");
        const report = await withPgClient(() => runScheduledLedgerJobs());
        console.log("[ledger] scheduled jobs", JSON.stringify(report));
      } catch (err) {
        console.error("[cron] Ledger scheduled jobs failed:", err);
      }
      // Daily AI visibility monitoring: compares stored answers and writes
      // alerts. Reads only; it never starts a collection or calls a provider.
      try {
        const { runScheduledMonitoring } =
          await import("@/server/features/monitoring/services/scheduledMonitoring");
        const report = await withPgClient(() => runScheduledMonitoring());
        console.log("[monitoring] scheduled run", JSON.stringify(report));
      } catch (err) {
        console.error("[cron] Monitoring scheduled run failed:", err);
      }
      try {
        const { deliverScheduledMarketReports } =
          await import("@/server/features/reports/services/marketReportDelivery");
        await withPgClient(() =>
          deliverScheduledMarketReports(new Date(controller.scheduledTime)),
        );
      } catch (err) {
        console.error("[cron] Market report delivery failed:", err);
      }
      // Daily re-check of acquired links: fetches only the linking pages
      // through the guarded fetcher and calls no paid provider.
      try {
        const { runScheduledLinkChecks } =
          await import("@/server/features/link-acquisition/services/LinkVerificationService");
        const report = await withPgClient(() => runScheduledLinkChecks());
        console.log("[link-check] scheduled run", JSON.stringify(report));
      } catch (err) {
        console.error("[cron] Link checks failed:", err);
      }
      // Weekly check that DataForSEO still accepts the requests the link
      // tools send and still returns what they read. Costs a few cents; a
      // failed check is logged as an error and kept for a D1 query.
      try {
        const { ProviderHealthService } =
          await import("@/server/features/provider-health/services/ProviderHealthService");
        const report = await withPgClient(() =>
          ProviderHealthService.runScheduled(),
        );
        console.log("[provider-health] scheduled run", JSON.stringify(report));
      } catch (err) {
        console.error("[cron] Provider health run failed:", err);
      }
      // Audit events older than the retention window are dropped.
      try {
        const { AuditLogService } =
          await import("@/server/features/audit-log/services/AuditLogService");
        await withPgClient(() => AuditLogService.prune());
      } catch (err) {
        console.error("[cron] Audit log prune failed:", err);
      }
      // Crawler visit counts older than a year are dropped.
      try {
        const { pruneCrawlerHits } =
          await import("@/server/features/ai-crawlers/services/aiCrawlerActivity");
        await withPgClient(() => pruneCrawlerHits());
      } catch (err) {
        console.error("[cron] Crawler hits prune failed:", err);
      }
      // Projects that connected Cloudflare analytics get the last days of
      // AI crawler visits refreshed.
      try {
        const { syncAllCloudflareCrawlerHits } =
          await import("@/server/features/ai-crawlers/services/aiCrawlerCloudflare");
        await withPgClient(() => syncAllCloudflareCrawlerHits());
      } catch (err) {
        console.error("[cron] Cloudflare crawler sync failed:", err);
      }
      // Attribution events that are still waiting to be turned into
      // conversions and credits are worked through, and old page views pruned.
      try {
        const { drainPendingProjects, pruneAttribution } =
          await import("@/server/features/attribution/services/attributionReprocess");
        await withPgClient(async () => {
          await drainPendingProjects();
          await pruneAttribution();
        });
      } catch (err) {
        console.error("[cron] Attribution drain failed:", err);
      }
      const authMode = getAuthMode(env.AUTH_MODE);
      // Only the modes with their own accounts run the OAuth provider (and
      // have OAUTH_KV bound).
      if (usesBetterAuth(authMode)) {
        const result = await caldrinSearchOAuthProvider.purgeExpiredData(
          env as CaldrinSearchOAuthEnv,
        );
        console.log("[mcp-oauth] purged expired OAuth data", result);
      }
      return;
    }

    // Watchdog first: reconcile audits stuck in "running" whose workflow died
    // without reaching mark-failed (OOM/CPU kills, expired instances). Runs
    // before the rank loop so a slow tick can't delay or starve it. Its
    // failure is held until after the rank checks so it can't suppress them,
    // then rethrown so the invocation still reports as failed.
    let watchdogError: unknown;
    try {
      await withPgClient(() => reconcileStaleAudits());
    } catch (err) {
      watchdogError = err;
      console.error("[cron] Stale-audit reconcile failed:", err);
    }
    // Scope a per-request Postgres client for the cron run (no-op in D1 mode).
    // Trackers start Workflows. Claim extraction only dispatches confirmed BYOK jobs.
    const checks = await Promise.allSettled([
      withPgClient(() => runScheduledRankChecks(env)),
      withPgClient(async () => {
        const { processClaimJobs } =
          await import("@/server/features/ai-claims/claimExtractionWorker");
        await processClaimJobs();
      }),
      withPgClient(async () => {
        const { reconcileContentRefresh } =
          await import("@/server/features/content/services/contentRefreshQueue");
        await reconcileContentRefresh();
      }),
      withPgClient(async () => {
        const { runScheduledAiVisibility } =
          await import("@/server/features/ai-visibility/services/scheduledAiVisibility");
        await runScheduledAiVisibility();
      }),
      withPgClient(async () => {
        const { runScheduledLocalChecks } =
          await import("@/server/features/local-seo/services/scheduledLocalChecks");
        await runScheduledLocalChecks();
      }),
    ]);
    for (const result of checks)
      if (result.status === "rejected") throw result.reason;
    if (watchdogError) throw watchdogError;
  },
};
