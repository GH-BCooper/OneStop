// Website Information Lookup (17-online-media-network-tools.md §13.9).
//
// Everything a person reasonably wants to know about a site without opening it: does it answer,
// where does it redirect, what does it call itself, what server is behind it, which security
// headers it sets, and — for https — who issued its certificate and when it expires.
//
// The fetch goes through `ssrf.ts`, so a link pointing at the server's own network is refused
// before a connection is made. The TLS check is a separate, short handshake: it needs the socket,
// not the page.
import { connect, type PeerCertificate } from "node:tls";
import { decodeBody, safeFetch, type SafeResponse } from "./ssrf.ts";

export interface CertificateInfo {
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysRemaining: number | null;
  altNames: string[];
  protocol: string | null;
  expired: boolean;
}

export interface SiteInfo {
  url: string;
  finalUrl: string;
  status: number;
  statusText: string;
  ok: boolean;
  redirects: { url: string; status: number }[];
  addresses: string[];
  server: string | null;
  poweredBy: string | null;
  contentType: string | null;
  contentLength: number | null;
  title: string | null;
  description: string | null;
  language: string | null;
  charset: string | null;
  generator: string | null;
  canonical: string | null;
  favicon: string | null;
  openGraph: Record<string, string>;
  securityHeaders: Record<string, string | null>;
  cookies: number;
  certificate: CertificateInfo | null;
  responseTimeMs: number;
  /** Set when the page body was cut off at the size cap. */
  truncated: boolean;
}

/** The headers worth calling out by name, because their absence is the interesting part. */
const SECURITY_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
];

function attribute(tag: string, name: string): string | null {
  const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const m = pattern.exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? null) : null;
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    "#39": "'",
  };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    const key = code.toLowerCase();
    if (named[key]) return named[key];
    if (key.startsWith("#x")) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith("#")) return String.fromCodePoint(Number(key.slice(1)));
    return whole;
  });
}

export interface PageMeta {
  title: string | null;
  description: string | null;
  language: string | null;
  charset: string | null;
  generator: string | null;
  canonical: string | null;
  favicon: string | null;
  openGraph: Record<string, string>;
}

/**
 * A small, deliberately forgiving HTML head reader. No parser dependency: the head of a page is
 * regular enough for this, and anything unrecognised simply comes back null.
 */
export function readPageMeta(html: string, base: string): PageMeta {
  const head = html.slice(0, 200_000);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const openGraph: Record<string, string> = {};
  let description: string | null = null;
  let generator: string | null = null;

  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const name = (attribute(tag, "name") ?? attribute(tag, "property") ?? "").toLowerCase();
    const content = attribute(tag, "content");
    if (!content) continue;
    if (name === "description" && !description) description = decodeEntities(content).trim();
    if (name === "generator" && !generator) generator = decodeEntities(content).trim();
    if (name.startsWith("og:") || name.startsWith("twitter:")) {
      openGraph[name] = decodeEntities(content).trim().slice(0, 500);
    }
  }

  let canonical: string | null = null;
  let favicon: string | null = null;
  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attribute(tag, "rel") ?? "").toLowerCase();
    const href = attribute(tag, "href");
    if (!href) continue;
    if (rel === "canonical" && !canonical) canonical = absolute(href, base);
    if (/(^|\s)icon(\s|$)/.test(rel) && !favicon) favicon = absolute(href, base);
  }

  const htmlTag = /<html\b[^>]*>/i.exec(head)?.[0] ?? "";
  const charsetMeta = /<meta\b[^>]*charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ?? null;

  return {
    title: title ? decodeEntities(title.replace(/\s+/g, " ")).trim().slice(0, 300) : null,
    description: description ? description.slice(0, 500) : null,
    language: attribute(htmlTag, "lang"),
    charset: charsetMeta,
    generator,
    canonical,
    favicon: favicon ?? absolute("/favicon.ico", base),
    openGraph,
  };
}

function absolute(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** A certificate field may repeat; the first value is the one people mean. */
function one(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** A short TLS handshake, just to read the certificate the site presents. */
export async function inspectCertificate(
  url: URL,
  timeoutMs = 10_000,
): Promise<CertificateInfo | null> {
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const port = url.port === "" ? 443 : Number(url.port);

  return new Promise((resolve) => {
    const socket = connect(
      { host, port, servername: host, timeout: timeoutMs, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate(false) as PeerCertificate;
        const protocol = socket.getProtocol();
        socket.end();
        if (!cert || Object.keys(cert).length === 0) {
          resolve(null);
          return;
        }
        const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
        const days =
          validTo && !Number.isNaN(validTo.getTime())
            ? Math.round((validTo.getTime() - Date.now()) / 86_400_000)
            : null;
        resolve({
          subject: one(cert.subject?.CN),
          issuer: one(cert.issuer?.O) ?? one(cert.issuer?.CN),
          validFrom: cert.valid_from ?? null,
          validTo: cert.valid_to ?? null,
          daysRemaining: days,
          altNames: (cert.subjectaltname ?? "")
            .split(",")
            .map((s) => s.trim().replace(/^DNS:/, ""))
            .filter((s) => s !== ""),
          protocol,
          expired: days !== null && days < 0,
        });
      },
    );
    const giveUp = () => {
      socket.destroy();
      resolve(null);
    };
    socket.on("timeout", giveUp);
    socket.on("error", giveUp);
  });
}

export interface SiteInfoOptions {
  /** Skip the TLS handshake (tests, and http:// sites). */
  certificate?: boolean;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  maxBytes?: number;
}

export async function lookupSite(raw: string, options: SiteInfoOptions = {}): Promise<SiteInfo> {
  const { certificate = true, fetchImpl, signal, maxBytes = 1024 * 1024 } = options;
  // `safeFetch` owns every failure here: a bad scheme, a private address, a timeout and a dead
  // host each already carry their own message.
  const response: SafeResponse = await safeFetch(raw, {
    maxBytes,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(signal ? { signal } : {}),
    headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
  });

  const finalUrl = new URL(response.url);
  const contentType = response.headers["content-type"] ?? null;
  const isHtml = /html|xml/i.test(contentType ?? "");
  const meta = isHtml
    ? readPageMeta(decodeBody(response), response.url)
    : {
        title: null,
        description: null,
        language: null,
        charset: null,
        generator: null,
        canonical: null,
        favicon: null,
        openGraph: {},
      };

  const security: Record<string, string | null> = {};
  for (const header of SECURITY_HEADERS) security[header] = response.headers[header] ?? null;

  const length = Number(response.headers["content-length"]);
  const cert = certificate ? await inspectCertificate(finalUrl).catch(() => null) : null;

  return {
    url: raw.trim(),
    finalUrl: response.url,
    status: response.status,
    statusText: response.statusText,
    ok: response.status >= 200 && response.status < 400,
    redirects: response.chain.slice(0, -1),
    addresses: response.addresses,
    server: response.headers.server ?? null,
    poweredBy: response.headers["x-powered-by"] ?? null,
    contentType,
    contentLength: Number.isFinite(length) ? length : null,
    ...meta,
    securityHeaders: security,
    cookies: response.headers["set-cookie"]
      ? response.headers["set-cookie"].split(/,(?=[^;]+=)/).length
      : 0,
    certificate: cert,
    responseTimeMs: response.elapsedMs,
    truncated: response.truncated,
  };
}

/** One sentence for the result panel. */
export function describeSite(info: SiteInfo): string {
  const name = info.title ? `"${info.title}"` : new URL(info.finalUrl).hostname;
  const parts = [`${name} answered with ${info.status} ${info.statusText}`.trim()];
  if (info.redirects.length > 0) {
    parts.push(`after ${info.redirects.length} redirect${info.redirects.length === 1 ? "" : "s"}`);
  }
  if (info.server) parts.push(`served by ${info.server}`);
  if (info.certificate?.daysRemaining !== null && info.certificate?.daysRemaining !== undefined) {
    parts.push(
      info.certificate.expired
        ? "its certificate has expired"
        : `its certificate expires in ${info.certificate.daysRemaining} days`,
    );
  }
  return `${parts.join(", ")}.`;
}
