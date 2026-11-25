import { env } from "cloudflare:workers";
import { AwsClient } from "aws4fetch";

export function isSesConfigured() {
  return Boolean(
    env.AWS_SES_ACCESS_KEY_ID &&
    env.AWS_SES_SECRET_ACCESS_KEY &&
    env.AWS_SES_REGION &&
    env.MAGIC_LINK_FROM,
  );
}

// SES v2 SendEmail over its REST API, signed with SigV4. A failed send throws,
// so the caller decides whether that is visible.
export async function sendSesEmail(input: {
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
}) {
  if (!isSesConfigured()) throw new Error("SES is not configured");
  const client = new AwsClient({
    accessKeyId: env.AWS_SES_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.AWS_SES_SECRET_ACCESS_KEY ?? "",
    region: env.AWS_SES_REGION,
    service: "ses",
  });
  const response = await client.fetch(
    `https://email.${env.AWS_SES_REGION}.amazonaws.com/v2/email/outbound-emails`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        FromEmailAddress: env.MAGIC_LINK_FROM,
        Destination: { ToAddresses: [input.to] },
        ...(input.replyTo ? { ReplyToAddresses: [input.replyTo] } : {}),
        Content: {
          Simple: {
            Subject: { Data: input.subject, Charset: "UTF-8" },
            Body: {
              Text: { Data: input.text, Charset: "UTF-8" },
              Html: { Data: input.html, Charset: "UTF-8" },
            },
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error(`SES send failed: ${response.status}`);
  }
}

export async function sendMagicLinkEmail(
  email: string,
  url: string,
  code: string | null,
) {
  const codeText = code
    ? `\n\nOr enter this code on the sign-in page: ${code}`
    : "";
  const codeHtml = code
    ? `<p>Or enter this code on the sign-in page:</p><p style="font-size:24px;font-weight:600;letter-spacing:4px">${code}</p>`
    : "";
  await sendSesEmail({
    to: email,
    subject: code
      ? `${code} is your Caldrin Search sign-in code`
      : "Your Caldrin Search sign-in link",
    text: `Sign in to Caldrin Search: ${url}${codeText}\n\nThe link and code work once and expire in 10 minutes. If you didn't ask for them, ignore this email.`,
    html: `<p>Sign in to Caldrin Search:</p><p><a href="${url}">Sign in</a></p>${codeHtml}<p>The link and code work once and expire in 10 minutes. If you didn't ask for them, ignore this email.</p>`,
  });
}

export async function sendVerificationEmailSes(email: string, url: string) {
  await sendSesEmail({
    to: email,
    subject: "Confirm your email for Caldrin Search",
    text: `Confirm your email to finish creating your Caldrin Search account: ${url}\n\nOpen it in the browser you signed up in, or you will need to set a new password.\n\nIf you didn't sign up, ignore this email.`,
    html: `<p>Confirm your email to finish creating your Caldrin Search account:</p><p><a href="${url}">Confirm email</a></p><p>Open it in the browser you signed up in, or you will need to set a new password.</p><p>If you didn't sign up, ignore this email.</p>`,
  });
}

export async function sendPasswordResetEmailSes(email: string, url: string) {
  await sendSesEmail({
    to: email,
    subject: "Reset your Caldrin Search password",
    text: `Reset your Caldrin Search password: ${url}\n\nThe link expires in 1 hour. If you didn't ask for it, ignore this email.`,
    html: `<p>Reset your Caldrin Search password:</p><p><a href="${url}">Reset password</a></p><p>The link expires in 1 hour. If you didn't ask for it, ignore this email.</p>`,
  });
}
