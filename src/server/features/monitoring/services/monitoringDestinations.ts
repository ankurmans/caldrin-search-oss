import { openSecret, sealSecret } from "@/server/lib/secret-box";
import { AppError } from "@/server/lib/errors";
import { MonitoringRepository as repo } from "../repositories/MonitoringRepository";

// Where a workspace's new alerts go besides the app. The Slack webhook is a
// secret that lets anyone post to a channel, so it is stored sealed and only
// ever read back as "configured".

/** Slack incoming webhooks only; the app never posts to another host. */
export function isSlackWebhookUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "hooks.slack.com" &&
      url.pathname.startsWith("/services/") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export async function getAlertDestinations(organizationId: string) {
  const row = await repo.getDestinations(organizationId);
  return {
    emailEnabled: row?.emailEnabled ?? false,
    slackConfigured: Boolean(row?.slackWebhookSealed),
  };
}

/** `slackWebhookUrl`: undefined keeps the saved one, null removes it. */
export async function saveAlertDestinations(
  organizationId: string,
  input: { emailEnabled: boolean; slackWebhookUrl?: string | null },
) {
  const current = await repo.getDestinations(organizationId);
  let slackWebhookSealed = current?.slackWebhookSealed ?? null;
  if (input.slackWebhookUrl === null) slackWebhookSealed = null;
  else if (input.slackWebhookUrl !== undefined) {
    if (!isSlackWebhookUrl(input.slackWebhookUrl))
      throw new AppError(
        "VALIDATION_ERROR",
        "Use a Slack incoming webhook URL (https://hooks.slack.com/services/...).",
      );
    slackWebhookSealed = await sealSecret(input.slackWebhookUrl);
  }
  await repo.saveDestinations(organizationId, {
    emailEnabled: input.emailEnabled,
    slackWebhookSealed,
  });
  return getAlertDestinations(organizationId);
}

export async function openSlackWebhook(organizationId: string) {
  const row = await repo.getDestinations(organizationId);
  if (!row?.slackWebhookSealed) return null;
  const url = await openSecret(row.slackWebhookSealed);
  return url && isSlackWebhookUrl(url) ? url : null;
}

/** Posts plain text. Throws on a non-2xx answer so the caller can log it. */
export async function postToSlack(webhookUrl: string, text: string) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Slack answered ${response.status}`);
}
