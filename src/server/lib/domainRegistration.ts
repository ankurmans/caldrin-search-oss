const WHOIS_TIMEOUT_MS = 4000;
const CREATED_LINE =
  /^\s*(?:creation date|created(?: on)?|domain registration date|registered on)\s*:\s*(\S+)/im;
const REFER_LINE = /^\s*(?:refer|whois)\s*:\s*(\S+)/im;

async function whoisQuery(server: string, query: string): Promise<string> {
  // Loaded on use: only the Worker runtime provides the module, and this file
  // sits in the import graph of code that also runs under test.
  const { connect } = await import("cloudflare:sockets");
  const socket = connect({ hostname: server, port: 43 });
  const writer = socket.writable.getWriter();
  await writer.write(new TextEncoder().encode(`${query}\r\n`));
  writer.releaseLock();
  const text = await new Response(socket.readable).text();
  await socket.close().catch(() => {});
  return text;
}

async function lookup(domain: string): Promise<string | null> {
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  const iana = await whoisQuery("whois.iana.org", tld);
  const server = REFER_LINE.exec(iana)?.[1];
  if (!server) return null;
  const created = CREATED_LINE.exec(await whoisQuery(server, domain))?.[1];
  const date = created ? new Date(created) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toISOString().slice(0, 10)
    : null;
}

// When the domain was last registered (a dropped name re-registered later gets
// a new date), straight from the registry's whois. Null whenever it cannot be
// read: the date only annotates a chart and must never fail the page.
export async function getDomainRegistrationDate(
  domain: string,
): Promise<string | null> {
  try {
    return await Promise.race([
      lookup(domain),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), WHOIS_TIMEOUT_MS),
      ),
    ]);
  } catch {
    return null;
  }
}
