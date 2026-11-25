import { useId, useState } from "react";
import {
  SITE_PLATFORMS,
  SITE_PLATFORM_LABELS,
  type SitePlatform,
} from "@/shared/site-platform";

const placement: Record<SitePlatform, string> = {
  wordpress:
    "Add the snippet to the site-wide header using a header-code plugin or the wp_head hook in your site plugin. Save and check a published page.",
  shopify:
    "Go to Online Store → Themes → Edit code. In the storefront theme’s layout/theme.liquid file, place the snippet just before the closing head tag. Save and check the live storefront.",
  webflow:
    "Open Site settings → Custom code. Add the snippet under Head code, save the settings, and publish the site.",
  framer:
    "Open Project Settings → Custom Code → Add Script. Choose the head, apply it to the whole site, set it to run once, and publish.",
  squarespace:
    "Open Code Injection and paste the snippet into Header, then save. Site-wide code injection requires an eligible plan and excludes checkout.",
  wix: "On the site dashboard, open Settings → Custom Code under Development & integrations. Add the snippet to Head, select all pages and load once per visit, then apply. The site needs a published, connected domain.",
  repository:
    "Add the snippet once to your shared root layout or base template, before the closing head tag. Deploy the site and check a published page.",
  unknown:
    "Add the snippet once in your website’s shared header, just before the closing head tag. Check a published page after saving.",
};

export function TrackerPlacement({ platform }: { platform: SitePlatform }) {
  const [override, setOverride] = useState<SitePlatform | null>(null);
  const selected = override ?? platform;
  const id = useId();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="font-medium" htmlFor={id}>
          Website builder
        </label>
        <select
          id={id}
          className="h-8 rounded-md border border-input bg-background px-2"
          value={selected}
          onChange={(event) => {
            setOverride(
              SITE_PLATFORMS.find(
                (item) => item === event.currentTarget.value,
              ) ?? null,
            );
          }}
        >
          {SITE_PLATFORMS.map((item) => (
            <option key={item} value={item}>
              {SITE_PLATFORM_LABELS[item]}
            </option>
          ))}
        </select>
      </div>
      <p className="text-muted-foreground">{placement[selected]}</p>
    </div>
  );
}
