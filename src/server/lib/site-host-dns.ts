import { publicFetch } from "@/server/lib/public-fetch";
import { isCloudflareIp } from "@/shared/site-host";

/** Whether the domain's address records point at Cloudflare's proxy; null when DNS cannot be read. */
export async function proxiedByCloudflare(domain: string) {
  try {
    const response = await publicFetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`,
      {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(3_000),
      },
    );
    const body: unknown = await response.json();
    const answers =
      typeof body === "object" && body !== null && "Answer" in body
        ? body.Answer
        : null;
    if (!Array.isArray(answers)) return null;
    const ips = answers.flatMap((answer: unknown) =>
      typeof answer === "object" &&
      answer !== null &&
      "type" in answer &&
      answer.type === 1 &&
      "data" in answer &&
      typeof answer.data === "string"
        ? [answer.data]
        : [],
    );
    return ips.length > 0 ? ips.some(isCloudflareIp) : null;
  } catch (error) {
    console.warn("Failed to read site DNS:", error);
    return null;
  }
}
