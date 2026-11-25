import { env } from "cloudflare:workers";
import { isSesConfigured, sendSesEmail } from "@/server/email/ses";
import { AppError } from "@/server/lib/errors";
import {
  FEEDBACK_KIND_LABELS,
  SUPPORT_EMAIL,
  type FeedbackKind,
} from "@/shared/support";

// A person can send a handful a day; this bounds abuse of an open mailbox.
const DAILY_LIMIT = 10;

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

async function withinDailyLimit(userId: string) {
  const key = `feedback:${userId}:${new Date().toISOString().slice(0, 10)}`;
  const count = Number((await env.KV.get(key)) ?? "0");
  if (count >= DAILY_LIMIT) return false;
  await env.KV.put(key, String(count + 1), { expirationTtl: 60 * 60 * 24 });
  return true;
}

/** Emails a feature request, improvement or problem report to support. */
export async function sendFeedback(input: {
  userId: string;
  userEmail: string;
  kind: FeedbackKind;
  message: string;
}) {
  if (!isSesConfigured()) {
    throw new AppError("INTERNAL_ERROR", "Email is not configured");
  }
  if (!(await withinDailyLimit(input.userId))) {
    throw new AppError("RATE_LIMITED", "Daily feedback limit reached");
  }
  const label = FEEDBACK_KIND_LABELS[input.kind];
  const lines = [`From: ${input.userEmail}`, `Type: ${label}`];
  await sendSesEmail({
    to: SUPPORT_EMAIL,
    replyTo: input.userEmail,
    subject: `[${label}] ${input.message.slice(0, 70).replace(/\s+/g, " ")}`,
    text: `${lines.join("\n")}\n\n${input.message}`,
    html: `<p>${lines.map(escapeHtml).join("<br>")}</p><p>${escapeHtml(input.message).replaceAll("\n", "<br>")}</p>`,
  });
}
