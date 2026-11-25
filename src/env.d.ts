// Custom environment variable type definitions
// These extend the auto-generated Env interface from worker-configuration.d.ts

declare namespace Cloudflare {
  interface Env {
    R2: R2Bucket;
    // Browser Run binding for site-audit JavaScript rendering, audit worker
    // only. Inline import preserves the ambient Env augmentation.
    // oxlint-disable-next-line typescript-eslint/consistent-type-imports
    BROWSER?: import("@cloudflare/workers-types").BrowserRun;
    // TinyFish key: the rendering fallback when Browser Run fails or is
    // blocked.
    TINYFISH_API_KEY?: string;
    OAUTH_KV: KVNamespace;

    // Durable Object backing the SAM in-app agent (see wrangler.jsonc).
    SAM_CHAT: DurableObjectNamespace;

    // Durable Object holding per-audit crawl scratch state (frontier, link
    // edges, page mirror). Bound ONLY in the caldrin-search-audit aux worker;
    // untyped here — getAuditScratchpad narrows the stub.
    AUDIT_SCRATCHPAD: DurableObjectNamespace;

    // Service binding to the audit worker's AuditEngine entrypoint (cancel +
    // scratchpad teardown). The inline import() is required: a
    // top-level import would turn this ambient file into a module and break
    // the global augmentation.
    // oxlint-disable-next-line typescript-eslint/consistent-type-imports
    AUDIT_ENGINE: Service<typeof import("./audit-worker").default>;

    AUTH_MODE?: "cloudflare_access" | "local_noauth" | "password";
    LOCAL_NOAUTH_ALLOW_NON_LOOPBACK?: string;
    BYPASS_EMAIL_VERIFICATION?: string;

    TEAM_DOMAIN?: string;
    POLICY_AUD?: string;
    // Flagship app holding feature flags (src/server/lib/featureFlags.ts).
    // Optional: with no binding every flag reads off.
    // oxlint-disable-next-line typescript-eslint/consistent-type-imports
    FLAGS?: import("@cloudflare/workers-types").Flagship;
    POSTHOG_PUBLIC_KEY?: string;
    POSTHOG_HOST?: string;
    BETTER_AUTH_SECRET?: string;
    BETTER_AUTH_URL?: string;
    // Encrypts saved Shopify crawler signatures. Kept separate from
    // BETTER_AUTH_SECRET so the audit worker never holds the auth secret.
    CRAWLER_ACCESS_SECRET?: string;
    // Private Ed25519 JWK that signs site audit requests (Web Bot Auth). Unset
    // sends unsigned requests.
    WEB_BOT_AUTH_JWK?: string;
    DATABASE_PROVIDER?: "d1" | "postgres";
    HYPERDRIVE?: {
      connectionString: string;
    };
    // Shopify app that connects stores (Content studio). Both unset: the
    // connect button is replaced by a "not configured" notice. Redirect URL to
    // register in the app: <public origin>/api/shopify/callback.
    SHOPIFY_CLIENT_ID?: string;
    SHOPIFY_CLIENT_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    // Magic-link email through AWS SES. Unset = no magic-link sign-in.
    AWS_SES_ACCESS_KEY_ID?: string;
    AWS_SES_SECRET_ACCESS_KEY?: string;
    AWS_SES_REGION?: string;
    MAGIC_LINK_FROM?: string;
    // "true" lets anyone sign up with Google or a magic link, each into a
    // private bring-your-own-key workspace. Password sign-up stays invite-only.
    OPEN_SIGNUP?: string;
    GOOGLE_MAPS_API_KEY?: string;

    // Cloudflare Turnstile — captcha on open sign-up. Secret verifies tokens
    // server-side; site key is public and inlined into the client build.
    TURNSTILE_SECRET_KEY?: string;
    TURNSTILE_SITE_KEY?: string;

    // DataForSEO API Basic auth value (base64 of login:password)
    DATAFORSEO_API_KEY: string;
    LOCAL_RANK_WORKFLOW: Workflow<
      Parameters<
        // oxlint-disable-next-line typescript-eslint/consistent-type-imports -- preserve ambient Env augmentation
        import("./server").LocalRankWorkflow["run"]
      >[0]["payload"]
    >;
    AI_VISIBILITY_WORKFLOW: Workflow<
      Parameters<
        // oxlint-disable-next-line typescript-eslint/consistent-type-imports -- preserve ambient Env augmentation
        import("./server").AiVisibilityWorkflow["run"]
      >[0]["payload"]
    >;

    // Anthropic API key; preferred over OpenRouter when set.
    ANTHROPIC_API_KEY?: string;
    // Answer-engine keys for Prompt Explorer and Claude/Perplexity tracking,
    // called directly with no middleman.
    PERPLEXITY_API_KEY?: string;
    OPENAI_API_KEY?: string;
    GEMINI_API_KEY?: string;
    // OpenRouter API key for the SAM in-app chat agent.
    OPENROUTER_API_KEY?: string;
    // Optional base URL to use another OpenRouter-compatible provider.
    OPENROUTER_BASE_URL?: string;
    // Optional OpenRouter model slug override (defaults in openrouter.ts).
    OPENROUTER_MODEL?: string;
  }
}

interface ImportMetaEnv {
  readonly AUTH_MODE?: "cloudflare_access" | "local_noauth" | "password";
  readonly LOCAL_NOAUTH_ALLOW_NON_LOOPBACK?: string;
  readonly DATABASE_PROVIDER?: "d1" | "postgres";
  readonly BYPASS_EMAIL_VERIFICATION?: string;
  readonly POSTHOG_PUBLIC_KEY?: string;
  readonly POSTHOG_HOST?: string;
  readonly TURNSTILE_SITE_KEY?: string;
  readonly VITE_E2E_DOMAIN_FIXTURES?: string;
  readonly VITE_E2E_KEYWORD_FIXTURES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.md?raw" {
  const content: string;
  export default content;
}
