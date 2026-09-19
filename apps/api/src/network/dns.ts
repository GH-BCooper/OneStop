// DNS lookups (17-online-media-network-tools.md).
//
// Node's own `node:dns` resolver, as the build file asks — nothing paid, nothing to install. The
// resolver is created per call so a custom DNS server (DNS_SERVERS) can be honoured and so a slow
// authority cannot hold a shared resolver open for the rest of the app.
import { Resolver } from "node:dns/promises";
import { offline, unsupported } from "./common.ts";
import { classifyIp, parseIp, reverseName } from "./ipAddress.ts";

export const RECORD_TYPES = [
  "A",
  "AAAA",
  "CNAME",
  "MX",
  "NS",
  "TXT",
  "SOA",
  "SRV",
  "CAA",
  "PTR",
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const DEFAULT_RECORD_TYPES: RecordType[] = ["A", "AAAA", "MX", "NS", "TXT", "SOA"];

export interface DnsAnswer {
  type: RecordType;
  records: unknown[];
  /** Set when this type could not be answered; the lookup as a whole still succeeds. */
  error?: string;
}

export interface DnsReport {
  name: string;
  servers: string[];
  answers: DnsAnswer[];
  elapsedMs: number;
}

/**
 * Accepts a bare domain, a host name or a full URL, and returns the host on its own. Rejects
 * anything that is not a name — an IP address belongs in the PTR path, not here.
 */
export function normalizeHost(raw: string): string {
  let text = raw.trim().toLowerCase();
  if (text === "") throw unsupported("Enter a domain name first.");
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(text)) {
    try {
      text = new URL(text).hostname;
    } catch {
      throw unsupported("That link could not be read. Enter a domain like example.com.");
    }
  }
  text = text.replace(/^\[|\]$/g, "").replace(/^\/+|\/.*$/g, "");
  text = text.replace(/^[^@]*@/, "").replace(/\.$/, "");
  const [host] = text.split(":");
  if (!host) throw unsupported("Enter a domain name first.");
  // Punycode: `URL` does the IDN conversion for us, so "bücher.de" arrives here as ASCII.
  try {
    const converted = new URL(`http://${host}`).hostname;
    if (converted !== "") text = converted;
    else text = host;
  } catch {
    text = host;
  }
  if (!/^(?=.{1,253}$)([a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z]{2,63}$/.test(text)) {
    throw unsupported(`"${raw.trim()}" is not a domain name. Try something like example.com.`);
  }
  return text;
}

/**
 * Public resolvers, used only when the machine has none this process can query. That happens more
 * often than it sounds: a system running a local stub resolver hands c-ares `127.0.0.1`, which it
 * cannot use, and the tool would otherwise report "no Internet" on a perfectly connected machine.
 * The answer names the server that was asked, so this is never invisible, and DNS_SERVERS
 * overrides it for anyone who would rather it did not happen.
 */
const PUBLIC_RESOLVERS = ["1.1.1.1", "8.8.8.8", "9.9.9.9"];

function makeResolver(): { resolver: Resolver; servers: string[] } {
  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  const configured = (process.env.DNS_SERVERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => parseIp(s) !== null);
  if (configured.length > 0) {
    resolver.setServers(configured);
  } else {
    const usable = resolver.getServers().filter((server) => {
      const ip = parseIp(server.replace(/^\[|\].*$/g, "").split("%")[0] ?? server);
      return ip !== null && classifyIp(ip).scope !== "loopback";
    });
    resolver.setServers(usable.length > 0 ? usable : PUBLIC_RESOLVERS);
  }
  return { resolver, servers: resolver.getServers() };
}

const NO_RECORD = new Set(["ENODATA", "ENOTFOUND", "ENOENT"]);

/**
 * Looks up the requested record types. A type with no records is reported as an empty list rather
 * than as a failure — "this domain has no MX records" is an answer, not an error. Only a total
 * failure (no such domain, no connectivity) throws.
 */
export async function lookupDns(
  host: string,
  types: RecordType[] = DEFAULT_RECORD_TYPES,
): Promise<DnsReport> {
  const name = normalizeHost(host);
  const { resolver, servers } = makeResolver();
  const started = Date.now();
  const answers: DnsAnswer[] = [];
  let reachable = false;
  let missing = 0;

  for (const type of types) {
    try {
      const records = (await resolver.resolve(name, type)) as unknown[];
      reachable = true;
      answers.push({ type, records: Array.isArray(records) ? records : [records] });
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      if (NO_RECORD.has(code)) {
        reachable = reachable || code === "ENODATA";
        if (code !== "ENODATA") missing++;
        answers.push({ type, records: [] });
      } else if (code === "ETIMEOUT" || code === "ESERVFAIL" || code === "EREFUSED") {
        answers.push({ type, records: [], error: `The name server did not answer (${code}).` });
      } else {
        throw offline(err);
      }
    }
  }

  if (!reachable && missing === types.length) {
    throw unsupported(`No DNS records exist for ${name}. Check the spelling and try again.`);
  }
  return { name, servers, answers, elapsedMs: Date.now() - started };
}

/** Reverse lookup: which names an address claims. Empty when it has no PTR record. */
export async function reverseLookup(address: string): Promise<string[]> {
  const ip = parseIp(address);
  if (!ip) throw unsupported("That is not a valid IP address.");
  const { resolver } = makeResolver();
  try {
    return await resolver.resolvePtr(reverseName(ip));
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    if (NO_RECORD.has(code) || code === "ESERVFAIL" || code === "ETIMEOUT") return [];
    throw offline(err);
  }
}

/** A short, readable line per record, for the downloadable report. */
export function formatAnswer(answer: DnsAnswer): string[] {
  return answer.records.map((record) => {
    if (typeof record === "string") return record;
    if (Array.isArray(record)) return record.join("");
    if (record && typeof record === "object") {
      const r = record as Record<string, unknown>;
      if ("exchange" in r) return `${String(r.priority)} ${String(r.exchange)}`;
      if ("nsname" in r)
        return `${String(r.nsname)} ${String(r.hostmaster)} serial ${String(r.serial)}`;
      if ("name" in r && "port" in r)
        return `${String(r.priority)} ${String(r.weight)} ${String(r.port)} ${String(r.name)}`;
      if ("issuerCritical" in r)
        return `${String(r.critical ?? 0)} ${String(r.issue ?? r.issuewild ?? r.iodef ?? "")}`;
      return JSON.stringify(record);
    }
    return String(record);
  });
}
