import { GTM_EDIT_SCOPE, GTM_PROVIDER_ID } from "@/shared/tag-manager";
import {
  GA4_DATA_SCOPE,
  GA4_OAUTH_PROVIDER_ID,
  GA4_OAUTH_SCOPES,
} from "@/shared/ga4";
import {
  GSC_DATA_SCOPE,
  GSC_OAUTH_PROVIDER_ID,
  GSC_OAUTH_SCOPES,
} from "@/shared/gsc";
import type { GoogleLinkProvider } from "@/shared/google-link";

export type GoogleOAuthIntegration = {
  provider: GoogleLinkProvider;
  providerId: string;
  displayName: string;
  callbackPath: `/${string}`;
  scopes: readonly string[];
  /** The data permission the integration can't work without. */
  requiredScope: string;
};

export const GSC_INTEGRATION: GoogleOAuthIntegration = {
  provider: "gsc",
  providerId: GSC_OAUTH_PROVIDER_ID,
  displayName: "Search Console",
  callbackPath: "/api/gsc/oauth/callback",
  scopes: GSC_OAUTH_SCOPES,
  requiredScope: GSC_DATA_SCOPE,
};

export const GA4_INTEGRATION: GoogleOAuthIntegration = {
  provider: "ga4",
  providerId: GA4_OAUTH_PROVIDER_ID,
  displayName: "Google Analytics",
  callbackPath: "/api/ga4/oauth/callback",
  scopes: GA4_OAUTH_SCOPES,
  requiredScope: GA4_DATA_SCOPE,
};

// Share the registered Search Console callback. The OAuth nonce
// carries the intended grant, so a callback cannot select its own scopes.
export const TAG_MANAGER_GRANT: GoogleOAuthIntegration = {
  ...GSC_INTEGRATION,
  providerId: GTM_PROVIDER_ID,
  displayName: "Google Tag Manager",
  scopes: [
    ...GSC_INTEGRATION.scopes.filter((scope) => scope !== GSC_DATA_SCOPE),
    GTM_EDIT_SCOPE,
  ],
  requiredScope: GTM_EDIT_SCOPE,
};
