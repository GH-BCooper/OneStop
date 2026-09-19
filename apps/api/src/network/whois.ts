// WHOIS lookups (17-online-media-network-tools.md).
//
// WHOIS is a one-line request over TCP port 43 (RFC 3912), so this is a socket, a timeout and a
// parser rather than a dependency — which keeps the build file's "no paid service needed" promise
// without adding a package that wraps twenty lines of `node:net`.
//
// Referrals: IANA knows which registry owns a TLD or an IP range, and that registry may in turn
// name the registrar that holds the detailed record. The chain is followed at most twice, and only
// to hosts that resolve to public addresses (`ssrf.ts`'s rule, applied to port 43 as well).
import { createConnection, type Socket } from "node:net";
import { classifyIp, parseIp } from "./ipAddress.ts";
import { normalizeHost } from "./dns.ts";
import { failed, offline, unsupported } from "./common.ts";
import { lookup as dnsLookup } from "node:dns/promises";

export const WHOIS_PORT = 43;
export const IANA_WHOIS = "whois.iana.org";
export const MAX_REFERRALS = 2;
const TIMEOUT_MS = 12_000;
const MAX_BYTES = 256 * 1024;

export interface WhoisHop {
  server: string;
  text: string;
}

export interface WhoisReport {
  query: string;
  kind: "domain" | "ip";
  /** Every server asked, in order, with what it said. */
  hops: WhoisHop[];
  /** The last, most specific response. */
  text: string;
  fields: WhoisFields;
  elapsedMs: number;
}

export interface WhoisFields {
  domain?: string;
  registrar?: string;
  registrarUrl?: string;
  registered?: string;
  updated?: string;
  expires?: string;
  status?: string[];
  nameServers?: string[];
  registrant?: string;
  registrantCountry?: string;
  dnssec?: string;
  /** IP lookups. */
  network?: string;
  netName?: string;
  organisation?: string;
  country?: string;
  abuseContact?: string;
  asn?: string;
}

/** Test seam: swap the socket layer without a network. */
export type WhoisTransport = (server: string, query: string) => Promise<string>;

let transport: WhoisTransport | null = null;

export function setWhoisTransport(next: WhoisTransport | null): void {
  transport = next;
}

async function assertPublicHost(server: string): Promise<void> {
  const literal = parseIp(server);
  const addresses = literal
    ? [literal.text]
    : (await dnsLookup(server, { all: true })).map((r) => r.address);
  for (const address of addresses) {
    const ip = parseIp(address);
    if (!ip || !classifyIp(ip).routable) {
      throw failed("That WHOIS server is not on the public Internet, so it was not contacted.");
    }
  }
}

function ask(server: string, query: string): Promise<string> {
  if (transport) return transport(server, query);
  return new Promise((resolve, reject) => {
    let socket: Socket;
    let text = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn();
    };
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(failed(`The WHOIS server ${server} did not answer. Try again in a moment.`)),
        ),
      TIMEOUT_MS,
    );
    timer.unref?.();
    try {
      socket = createConnection({ host: server, port: WHOIS_PORT });
    } catch (err) {
      clearTimeout(timer);
      reject(offline(err));
      return;
    }
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${query}\r\n`));
    socket.on("data", (chunk: string) => {
      text += chunk;
      if (text.length > MAX_BYTES) finish(() => resolve(text.slice(0, MAX_BYTES)));
    });
    socket.on("end", () => finish(() => resolve(text)));
    socket.on("close", () => finish(() => resolve(text)));
    socket.on("error", (err) => finish(() => reject(offline(err))));
  });
}

/** "refer:", "whois:" and "Registrar WHOIS Server:" all mean "ask this server instead". */
export function referralFrom(text: string): string | null {
  const patterns = [
    /^\s*refer:\s*(\S+)\s*$/im,
    /^\s*whois:\s*(\S+)\s*$/im,
    /^\s*Registrar WHOIS Server:\s*(\S+)\s*$/im,
    /^\s*ReferralServer:\s*(?:r?whois:\/\/)?([^\s:/]+)/im,
  ];
  for (const pattern of patterns) {
    const found = pattern.exec(text)?.[1];
    if (found) {
      const server = found
        .replace(/^r?whois:\/\//i, "")
        .replace(/[/:].*$/, "")
        .toLowerCase();
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(server)) return server;
    }
  }
  return null;
}

const LABELS: [keyof WhoisFields, RegExp, boolean?][] = [
  ["domain", /^\s*(?:Domain Name|domain):\s*(.+)$/im],
  ["registrar", /^\s*(?:Registrar|Sponsoring Registrar):\s*(.+)$/im],
  ["registrarUrl", /^\s*Registrar URL:\s*(.+)$/im],
  ["registered", /^\s*(?:Creation Date|Created On|created|registered):\s*(.+)$/im],
  ["updated", /^\s*(?:Updated Date|Last Modified|changed|last-modified):\s*(.+)$/im],
  ["expires", /^\s*(?:Registry Expiry Date|Expiration Date|Expiry Date|paid-till):\s*(.+)$/im],
  [
    "registrant",
    /^\s*(?:Registrant Organization|Registrant Name|org-name|organisation):\s*(.+)$/im,
  ],
  ["registrantCountry", /^\s*Registrant Country:\s*(.+)$/im],
  ["dnssec", /^\s*DNSSEC:\s*(.+)$/im],
  ["status", /^\s*(?:Domain Status|status):\s*(.+)$/gim, true],
  ["nameServers", /^\s*(?:Name Server|nserver):\s*(.+)$/gim, true],
  // IP records.
  ["network", /^\s*(?:NetRange|inetnum|inet6num|CIDR):\s*(.+)$/im],
  ["netName", /^\s*(?:NetName|netname):\s*(.+)$/im],
  ["organisation", /^\s*(?:OrgName|org-name|owner|descr):\s*(.+)$/im],
  ["country", /^\s*[Cc]ountry:\s*(.+)$/im],
  ["abuseContact", /^\s*(?:OrgAbuseEmail|abuse-mailbox|e-mail):\s*(\S+@\S+)\s*$/im],
  ["asn", /^\s*(?:OriginAS|origin|aut-num):\s*(AS\d+|\d+)\s*$/im],
];

/** Pulls the fields people actually want out of the free-text response. */
export function parseWhois(text: string): WhoisFields {
  const fields: WhoisFields = {};
  for (const [key, pattern, many] of LABELS) {
    if (many) {
      const values = [...text.matchAll(pattern)]
        .map((m) => m[1]!.trim())
        .filter((v) => v !== "")
        .map((v) => v.replace(/\s+\(https?:\/\/\S+\)$/, ""));
      const unique = [...new Set(values)];
      if (unique.length > 0) (fields[key] as string[]) = unique;
    } else {
      const value = pattern.exec(text)?.[1]?.trim();
      if (value && value !== "" && !/^(REDACTED|DATA REDACTED|Not Disclosed)/i.test(value)) {
        (fields[key] as string) = value;
      }
    }
  }
  return fields;
}

const NOT_FOUND =
  /\b(no match|not found|no entries found|no data found|nothing found|status:\s*free|no object found)\b/i;

/** "www.example.co.uk" -> "uk": the label IANA keeps the registry referral under. */
function tldOf(domain: string): string {
  return domain.split(".").pop() ?? domain;
}

/** Domain or IP -> the registry record, following at most `MAX_REFERRALS` referrals. */
export async function whois(rawQuery: string): Promise<WhoisReport> {
  const started = Date.now();
  const literal = parseIp(rawQuery.trim());
  const kind: "domain" | "ip" = literal ? "ip" : "domain";
  const query = literal ? literal.text : normalizeHost(rawQuery);

  const hops: WhoisHop[] = [];
  let server = IANA_WHOIS;
  const seen = new Set<string>();

  for (let hop = 0; hop <= MAX_REFERRALS; hop++) {
    if (seen.has(server)) break;
    seen.add(server);
    if (!transport) await assertPublicHost(server);
    // IANA is asked for the *TLD*, not the domain: that is the record that names the registry to
    // ask next. Asking it for the full domain usually works too, but a handful of names (the
    // reserved ones, example.com among them) have their own IANA entry with no referral in it,
    // and the lookup would stop there with nothing useful.
    const question = server === IANA_WHOIS && kind === "domain" ? tldOf(query) : query;
    const text = await ask(server, question);
    hops.push({ server, text });
    const next = referralFrom(text);
    if (!next || next === server) break;
    server = next;
  }

  // The last hop that actually said something about the query wins; IANA's own reply is only a
  // pointer, so prefer a later, longer answer.
  const useful = [...hops].reverse().find(
    (h) =>
      h.text.trim() !== "" &&
      !NOT_FOUND.test(h.text) &&
      // The IANA hop described the TLD, not the name that was asked about, so it is never the
      // answer to a domain query - reporting the registry's own name servers as the domain's
      // would be worse than saying nothing.
      !(h.server === IANA_WHOIS && kind === "domain"),
  );
  const last = useful ?? hops[hops.length - 1];
  if (!last) throw offline();
  if (!useful) {
    // Some registries (Nominet's .uk among them) publish no WHOIS server at all, so IANA has
    // nowhere to send the query on to. That is a fact about the registry, not a failure here.
    if (kind === "domain" && hops.length === 1 && hops[0]!.server === IANA_WHOIS) {
      throw unsupported(
        `The .${tldOf(query)} registry does not publish WHOIS records over the open protocol, so there is nothing OneStop can look up for ${query}.`,
      );
    }
    if (NOT_FOUND.test(last.text)) {
      throw unsupported(
        kind === "domain"
          ? `${query} is not registered, or its registry does not publish a record for it.`
          : `No registry record was found for ${query}.`,
      );
    }
  }

  return {
    query,
    kind,
    hops,
    text: last.text,
    fields: parseWhois(last.text),
    elapsedMs: Date.now() - started,
  };
}
