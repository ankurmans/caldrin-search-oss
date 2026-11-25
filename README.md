<div align="center">

# Caldrin Search (open edition)

**See where you rank in Google, and what AI answers say about you. On your own Cloudflare account, with your own keys.**

[![Licence: AGPL v3](https://img.shields.io/badge/licence-AGPL--3.0-blue)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/ankurmans/caldrin-search-oss?color=brightgreen)](https://github.com/ankurmans/caldrin-search-oss/releases)
[![GitHub stars](https://img.shields.io/github/stars/ankurmans/caldrin-search-oss?style=flat&color=yellow)](https://github.com/ankurmans/caldrin-search-oss/stargazers)
![Self-hosted](https://img.shields.io/badge/self--hosted-yes-success)

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![TanStack Start](https://img.shields.io/badge/TanStack_Start-FF4154)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)
![D1](https://img.shields.io/badge/D1_·_KV_·_R2-F38020)
![Drizzle](https://img.shields.io/badge/Drizzle-C5F74F?logo=drizzle&logoColor=black)
![MCP server](https://img.shields.io/badge/MCP-server-8A2BE2)

[Quick start](#quick-start-local) · [Screenshots](#screenshots) · [Self-hosting](docs/SELF_HOSTING.md) · [Hosted version](https://search.caldrin.co)

<img src="docs/screenshots/ai-visibility.png" alt="AI visibility dashboard: 40% visibility with a bar for each of ChatGPT, Gemini, Google AI Overviews and Perplexity" width="900">

</div>

A hosted version runs at [search.caldrin.co](https://search.caldrin.co). Built by [@ankurmans](https://github.com/ankurmans).

A self-hosted SEO and AI-visibility workspace for one project on your own Cloudflare account (Workers, D1, KV, R2). You bring your own provider keys; nothing is billed or proxied through anyone else.

Included: keyword research, rank tracking, site audits, backlinks, AI-answer monitoring with source evidence, Content Studio, Change Ledger, reports and exports, and a scoped MCP server.

Not included: hosted wallet and checkout, managed client logins, white-label branding and cross-client agency automation.

## Screenshots

Screenshots use made-up sample data, except the site audit, which is a crawl of the public test site books.toscrape.com. Your numbers come from your own provider keys.

| AI visibility over time and against competitors | What AI answers say about each brand |
| --- | --- |
| <img src="docs/screenshots/ai-trend.png" alt="Visibility trend line and brand leaderboard"> | <img src="docs/screenshots/perception.png" alt="Heatmap of recommended, neutral and negative mentions by topic and brand"> |
| **Rank tracking** | **Local rank grid** (the map background needs a Google Maps key) |
| <img src="docs/screenshots/rank-tracking.png" alt="Position distribution chart and keyword table"> | <img src="docs/screenshots/local-grid.png" alt="Seven by seven grid of local map rankings"> |
| **Site audit** | |
| <img src="docs/screenshots/site-audit.png" alt="Site audit with issues grouped by severity"> | |

## Quick start (local)

```sh
pnpm install --frozen-lockfile
printf 'AUTH_MODE=password\nBETTER_AUTH_URL=http://127.0.0.1:4334\nBETTER_AUTH_SECRET=%s\n' "$(openssl rand -hex 32)" > .env.local
pnpm db:migrate:local
pnpm build && pnpm preview
```

The settings must be in `.env.local`: variables set on the command line do not reach the app. Without the file it runs with no login at all, for use on your own machine only.

Open http://127.0.0.1:4334. The first visitor creates the administrator. Add your provider keys under Settings. See `docs/SELF_HOSTING.md` to run it on your own Cloudflare account.

## Known limitations

- Spend limits stop scheduled checks, drafting and gap research. They do not yet count keyword, domain, backlink, rank or AI-visibility lookups that you or an agent start.
- The built-in chat agent can change data without asking first, including after reading text on a web page. Give chat access only to people you trust with those changes.
- Live provider integrations are covered by tests with stand-ins; check them with your own keys.

## Security

See `SECURITY.md`.

## Licence

AGPL-3.0 (`LICENSE`). The Caldrin name and logo are not covered by it; see `NOTICE.md`. Third-party notices are in `NOTICE.md` and `THIRD_PARTY_NOTICES.md`.
