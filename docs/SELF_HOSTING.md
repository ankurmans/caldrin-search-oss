# Self-hosting on Cloudflare

The open edition runs as two Workers (app and audit engine) with one D1 database, two KV namespaces and one R2 bucket, all in your account. Provider keys (DataForSEO, model providers) are saved per workspace in Settings and are never read from deployment secrets.

## 1. Create resources

```sh
pnpm exec wrangler d1 create caldrin-search
pnpm exec wrangler kv namespace create KV
pnpm exec wrangler kv namespace create OAUTH_KV
pnpm exec wrangler r2 bucket create caldrin-search-assets
```

## 2. Configure

The build reads `wrangler.byok-preview.jsonc` and `wrangler.audit.byok-preview.jsonc`. Replace both with your values:

```sh
cp wrangler.deploy.example.jsonc wrangler.byok-preview.jsonc
cp wrangler.audit.deploy.example.jsonc wrangler.audit.byok-preview.jsonc
```

Fill in every `REPLACE_` value (D1 id and name, KV ids, bucket, your hostname in `BETTER_AUTH_URL`). Keep the worker and workflow names unchanged.

## 3. Migrate, build, deploy

```sh
pnpm exec wrangler d1 migrations apply DB --config wrangler.byok-preview.jsonc --remote
pnpm build
pnpm exec wrangler deploy --config dist/caldrin_search_audit_byok_preview/wrangler.json
pnpm exec wrangler deploy --config dist/server/wrangler.json
pnpm exec wrangler secret put BETTER_AUTH_SECRET --config dist/server/wrangler.json
```

`BETTER_AUTH_SECRET` is at least 32 random characters. Set it before the first request.

## 4. First run

Open your hostname; the first visitor creates the administrator, so do this yourself before sharing the URL. Add provider keys under Settings. Optional Google Search Console, Analytics and Maps setup: `docs/SELF_HOSTING_GOOGLE_*.md`, `docs/GOOGLE_MAPS_SETUP.md`.

## Upgrading

Pull the new release, run the migrations command from step 3, build and deploy again. Migrations are forward-only; export your data before upgrading.

## Notes

- Share-image rendering may fetch emoji artwork from a public CDN when a share image contains emoji.
- Analytics is off unless you set `POSTHOG_PUBLIC_KEY` and `POSTHOG_HOST` yourself.
