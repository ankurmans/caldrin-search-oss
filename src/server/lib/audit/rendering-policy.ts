import { hasProviderAccess } from "@/server/lib/provider-access";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

// Rendering works when a renderer exists. Alchemy deployments (hosted,
// previews, self-hosted Cloudflare) bind Browser Run to the audit worker and
// set AUDIT_BROWSER_RENDERING on the app worker; local development sets the
// same flag to attach a remote browser. A deployment with no browser renders
// only through TinyFish, with its key.
// Hosted accounts pay for rendering with usage credits; self-hosted operators
// pay their own Cloudflare and TinyFish accounts.
export async function isAuditRenderingAllowed(): Promise<boolean> {
  if (await hasProviderAccess("tinyfish")) return true;
  return (await getOptionalEnvValue("AUDIT_BROWSER_RENDERING")) === "true";
}

/**
 * Why a rendered audit can't start here, for the person who asked (and the
 * agent, as the tool's answer).
 */
export async function auditRenderingUnavailableMessage(): Promise<string> {
  return "JavaScript rendering is not available on this deployment. It needs a Cloudflare deployment with Browser Run, or TINYFISH_API_KEY. Run the audit without rendering instead.";
}
