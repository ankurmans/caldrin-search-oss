import { AI_BOT_USER_AGENT_TOKENS } from "./ai-bots";
import type { SiteHost } from "./site-host";

const CLOUDFLARE_PERMISSIONS = [
  { key: "zone", type: "read" },
  { key: "analytics", type: "read" },
];

/** Opens Cloudflare's token page with the two read permissions already ticked. */
export const CLOUDFLARE_TOKEN_URL = `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(JSON.stringify(CLOUDFLARE_PERMISSIONS))}&accountId=*&zoneId=all&name=${encodeURIComponent("Caldrin Search AI crawler visits")}`;

const KEY_PLACEHOLDER = "YOUR_KEY";

/** The steps for one site, written so a marketer can send them to whoever runs the hosting. */
export function developerMessage(input: {
  host: SiteHost;
  domain: string;
  origin: string;
  key: string | null;
}) {
  const { host, domain, origin } = input;
  const key = input.key ?? KEY_PLACEHOLDER;
  const endpoint = `${origin}/api/crawler-logs`;
  if (host === "cloudflare")
    return `Could you create a read-only Cloudflare API token for Caldrin Search? It lets Caldrin read the number of AI crawler visits to ${domain}. It cannot change anything.

1. Open this link, which fills in the permissions: ${CLOUDFLARE_TOKEN_URL}
2. Click Continue to summary, then Create Token.
3. Send me the token privately and I will add it in Caldrin.`;
  if (host === "vercel")
    return `Could you set up a log drain in Vercel so Caldrin Search can count AI crawler visits to ${domain}? It takes about five minutes and needs a Vercel Pro or Enterprise plan.

1. In Vercel, open Team Settings, then Drains, then Add Drain, and choose Logs.
2. Sources: Functions, Edge Functions and Static Files. Environment: Production. Project: only the one for ${domain}. Leave sampling at 100%.
3. Destination: a custom HTTP endpoint at ${endpoint} (format JSON).
4. Add one custom header, written on a single line: Authorization: Bearer ${key}
5. Save the drain.

The key works for this site only. Vercel bills drains by the amount of data sent, so keep the drain limited to this one project.`;
  return `Could you send ${domain}'s web server access log to Caldrin Search? Caldrin counts the AI crawler visits in it and keeps nothing else.

Send each new log file once, for example from a daily job (a file sent twice is counted twice):

curl -X POST --data-binary @access.log -H "Authorization: Bearer ${key}" ${endpoint}

Apache and nginx access logs both work. The key works for this site only.`;
}

// Vercel's drain filter (API only): sends and bills just AI crawler requests.
const DRAIN_FILTER = AI_BOT_USER_AGENT_TOKENS.map(
  (token) => `contains(log/userAgent, '${token}')`,
).join(" or ");

/** The same job as a task for an AI agent (Claude Code, Codex, Cursor) that manages the hosting. */
export function agentMessage(input: {
  host: SiteHost;
  domain: string;
  origin: string;
  key: string | null;
}) {
  const { host, domain, origin } = input;
  const key = input.key ?? KEY_PLACEHOLDER;
  if (host === "cloudflare")
    return `Task: create a read-only Cloudflare API token so Caldrin Search can count AI crawler visits to ${domain}.

Using the Cloudflare access you already have, create a token with the permissions Zone > Zone > Read and Zone > Analytics > Read, limited to the zone for ${domain} (POST /client/v4/user/tokens). Give me the token value once and do not store or log it. I will paste it into Caldrin.`;
  if (host === "vercel")
    return `Task: create a Vercel log drain that sends AI crawler requests for ${domain} to Caldrin Search.

Use the Vercel CLI (vercel drains create) or the Vercel REST API / MCP drains tools. Settings:
- Name: caldrin-ai-crawlers. Type: logs. Format: JSON.
- URL: ${origin}/api/crawler-logs
- Header: Authorization: Bearer ${key}
- Sources: lambda, edge, static. Environment: production. Only the Vercel project for ${domain}. Sampling 100%.
- Filter (OData, REST API only), so Vercel sends and bills only AI crawler requests: ${DRAIN_FILTER}

Needs a Vercel Pro or Enterprise plan. Do not print the key anywhere else.`;
  return `Task: send ${domain}'s web server access logs to Caldrin Search, which counts the AI crawler visits in them and keeps nothing else.

POST each new log file once (Apache or nginx format; a file sent twice is counted twice), for example from a daily job:
curl -X POST --data-binary @access.log -H "Authorization: Bearer ${key}" ${origin}/api/crawler-logs

Do not print the key anywhere else.`;
}
