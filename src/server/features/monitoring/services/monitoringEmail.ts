import { isSesConfigured, sendSesEmail } from "@/server/email/ses";
import { MonitoringRepository as repo } from "../repositories/MonitoringRepository";
import {
  getAlertDestinations,
  openSlackWebhook,
  postToSlack,
} from "./monitoringDestinations";

// Alerts are in-app by default. A workspace owner or admin can add email (to
// the workspace owners, needs SES) and a Slack channel in Settings; a workspace
// with no destination row stays in-app only.

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * Sends new alerts to the workspace's chosen destinations: email to the owners
 * (stamps emailed_at; a failed send is logged and the alert stays in-app) and
 * a Slack channel. Returns how many alerts went out by either route.
 */
export async function deliverAlerts(scope: {
  projectId: string;
  organizationId: string;
  alertIds: string[];
}): Promise<number> {
  if (!scope.alertIds.length) return 0;
  const [destinations, slackUrl] = await Promise.all([
    getAlertDestinations(scope.organizationId),
    openSlackWebhook(scope.organizationId),
  ]);
  const byEmail = destinations.emailEnabled && isSesConfigured();
  if (!byEmail && !slackUrl) return 0;
  const recipients = byEmail
    ? await repo.listOwnerEmails(scope.organizationId)
    : [];
  let sent = 0;
  for (const alert of await repo.getAlerts(scope.projectId, scope.alertIds)) {
    if (alert.emailedAt) continue;
    let delivered = false;
    if (recipients.length)
      try {
        for (const to of recipients)
          await sendSesEmail({
            to,
            subject: alert.title,
            text: alert.body,
            html: alert.body
              .split("\n")
              .map((line) => `<p>${escapeHtml(line)}</p>`)
              .join(""),
          });
        await repo.markEmailed(
          scope.projectId,
          alert.id,
          new Date().toISOString(),
        );
        delivered = true;
      } catch (error) {
        console.error("[monitoring] alert email failed", {
          alertId: alert.id,
          error,
        });
      }
    if (slackUrl)
      try {
        await postToSlack(slackUrl, `*${alert.title}*\n${alert.body}`);
        delivered = true;
      } catch (error) {
        console.error("[monitoring] alert Slack post failed", {
          alertId: alert.id,
          error,
        });
      }
    if (delivered) sent++;
  }
  return sent;
}
