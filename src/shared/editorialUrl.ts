export function ownsEditorialUrl(
  domain: string | null | undefined,
  url: string,
) {
  if (!domain) return false;
  try {
    const target = new URL(url);
    const site = new URL(domain.includes("://") ? domain : `https://${domain}`);
    return (
      ["http:", "https:"].includes(target.protocol) &&
      !target.username &&
      !target.password &&
      !target.port &&
      site.hostname.replace(/^www\./, "") ===
        target.hostname.replace(/^www\./, "")
    );
  } catch {
    return false;
  }
}
