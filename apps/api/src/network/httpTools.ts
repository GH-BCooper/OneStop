// Network additions from 21-roadmap-expansion.md (roadmap §1.9, §1.8's API Request Tester and
// §1.10's Weather Lookup).
//
// Every one of these is Internet-required by nature and says so in the registry. They all go
// through the existing SSRF guard (`./ssrf.ts`) or Node's own `tls`/`dns` — no third-party service,
// no API key anywhere, and each one degrades to a clear "this needs the internet" message offline.
import { connect as tlsConnect, type DetailedPeerCertificate, type PeerCertificate } from "node:tls";
import type { Executor } from "@onestop/tool-registry";
import { Resolver } from "node:dns/promises";
import {
  MIME,
  failed,
  jsonFile,
  offline,
  optBool,
  optEnum,
  optNumber,
  optString,
  plural,
  rateLimit,
  requireText,
  runNetTool,
  safeStem,
  textFile,
  unsupported,
} from "./common.ts";
import { checkUrl, decodeBody, parseSafeUrl, safeFetch } from "./ssrf.ts";

// ---- SSL / TLS certificate checker ------------------------------------------------------------

export interface CertificateReport {
  host: string;
  port: number;
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  expired: boolean;
  altNames: string[];
  matchesHost: boolean;
  serialNumber: string;
  fingerprint256: string;
  keyType: string;
  protocol: string;
  cipher: string;
  chain: { subject: string; issuer: string; validTo: string }[];
  authorized: boolean;
  authorizationError: string | null;
  warnings: string[];
}

/** `*.example.com` matches one label, and only one — the rule browsers actually apply. */
export function hostMatchesName(host: string, name: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  const n = name.toLowerCase().replace(/\.$/, "");
  if (n === h) return true;
  if (!n.startsWith("*.")) return false;
  const suffix = n.slice(1); // ".example.com"
  return h.endsWith(suffix) && h.slice(0, h.length - suffix.length).includes(".") === false;
}

function certName(cert: Partial<PeerCertificate>): string {
  const subject = cert.subject as Record<string, string> | undefined;
  return subject?.CN ?? subject?.O ?? "(unnamed)";
}

export function describeCertificate(
  host: string,
  port: number,
  cert: DetailedPeerCertificate,
  extra: { protocol: string; cipher: string; authorized: boolean; authorizationError: string | null },
  now = Date.now(),
): CertificateReport {
  const altNames = (cert.subjectaltname ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^DNS:/i, ""))
    .filter(Boolean);
  const validTo = new Date(cert.valid_to).getTime();
  const daysRemaining = Math.floor((validTo - now) / 86_400_000);
  const chain: CertificateReport["chain"] = [];
  let node: DetailedPeerCertificate | undefined = cert;
  const seen = new Set<string>();
  while (node && !seen.has(node.fingerprint256 ?? String(chain.length))) {
    seen.add(node.fingerprint256 ?? String(chain.length));
    chain.push({ subject: certName(node), issuer: (node.issuer as Record<string, string>)?.CN ?? "(unknown)", validTo: node.valid_to });
    node = node.issuerCertificate && node.issuerCertificate !== node ? node.issuerCertificate : undefined;
  }
  const matchesHost = altNames.some((n) => hostMatchesName(host, n)) || hostMatchesName(host, certName(cert));
  const warnings: string[] = [];
  if (daysRemaining < 0) warnings.push("This certificate has already expired.");
  else if (daysRemaining < 14) warnings.push(`It expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} — renew it now.`);
  else if (daysRemaining < 30) warnings.push(`It expires in ${daysRemaining} days.`);
  if (!matchesHost) warnings.push(`It does not cover "${host}", so browsers will refuse it.`);
  if (!extra.authorized) warnings.push(`The chain did not validate: ${extra.authorizationError ?? "unknown reason"}.`);
  if (chain.length === 1) warnings.push("Only one certificate was sent, so the chain may be incomplete for some clients.");

  return {
    host,
    port,
    subject: certName(cert),
    issuer: (cert.issuer as Record<string, string>)?.CN ?? "(unknown)",
    validFrom: new Date(cert.valid_from).toISOString(),
    validTo: new Date(cert.valid_to).toISOString(),
    daysRemaining,
    expired: daysRemaining < 0,
    altNames,
    matchesHost,
    serialNumber: cert.serialNumber ?? "",
    fingerprint256: cert.fingerprint256 ?? "",
    keyType: cert.asn1Curve ? `EC (${cert.asn1Curve})` : cert.bits ? `RSA ${cert.bits} bit` : "unknown",
    protocol: extra.protocol,
    cipher: extra.cipher,
    chain,
    authorized: extra.authorized,
    authorizationError: extra.authorizationError,
    warnings,
  };
}

/** A hostname or URL in, `{host, port}` out — and never a private address (the SSRF guard runs). */
async function resolveTarget(raw: string, defaultPort: number): Promise<{ host: string; port: number }> {
  const text = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  const { url } = await checkUrl(withScheme);
  return { host: url.hostname, port: url.port === "" ? defaultPort : Number(url.port) };
}

export const sslCheckerExecutor: Executor = (input, options, ctx) =>
  runNetTool("ssl-certificate-checker", async () => {
    rateLimit(ctx?.clientIp ?? "local", { limit: 20, windowMs: 60_000 });
    const { host, port } = await resolveTarget(requireText(input, "a hostname, like example.com"), optNumber(options, "port", 443, { min: 1, max: 65535 }));
    const report = await new Promise<CertificateReport>((resolve, reject) => {
      // `rejectUnauthorized: false` is deliberate and is the whole point: the tool must be able to
      // *report* on a bad certificate, which means completing the handshake and inspecting it.
      // Nothing is sent over the socket and the result is never trusted for anything else.
      const socket = tlsConnect(
        { host, port, servername: host, rejectUnauthorized: false, timeout: 12_000, ALPNProtocols: ["http/1.1"] },
        () => {
          const cert = socket.getPeerCertificate(true);
          const error = socket.authorizationError as unknown;
          if (!cert || Object.keys(cert).length === 0) {
            socket.destroy();
            reject(failed(`${host}:${port} answered, but sent no TLS certificate.`));
            return;
          }
          resolve(
            describeCertificate(host, port, cert, {
              protocol: socket.getProtocol() ?? "unknown",
              cipher: socket.getCipher()?.name ?? "unknown",
              authorized: socket.authorized,
              authorizationError: error ? String((error as Error).message ?? error) : null,
            }),
          );
          socket.end();
        },
      );
      socket.setTimeout(12_000, () => {
        socket.destroy();
        reject(failed(`${host}:${port} did not answer in time. Check the host and port.`));
      });
      socket.on("error", (err) => reject(offline(err)));
    });
    return {
      ok: true,
      output: { ...report, result: `${report.issuer} → ${report.subject}, ${report.daysRemaining} days left` },
      summary: `${report.subject}, issued by ${report.issuer}. ${report.expired ? "Expired" : `Valid for another ${report.daysRemaining} day${report.daysRemaining === 1 ? "" : "s"}`} (until ${report.validTo.slice(0, 10)}), over ${report.protocol}.${report.warnings.length ? ` ${report.warnings[0]}` : ""}`,
      files: [jsonFile(`${safeStem(host, "certificate")}-certificate.json`, report)],
    };
  });

// ---- HTTP security header grader --------------------------------------------------------------

export interface HeaderCheck {
  header: string;
  present: boolean;
  value: string | null;
  weight: number;
  earned: number;
  advice: string;
}

/**
 * Weights roughly follow how much each header actually reduces risk in practice — CSP is worth far
 * more than Referrer-Policy — and a partial score is given where a header exists but is weak.
 */
export function gradeHeaders(headers: Record<string, string>, https: boolean): { checks: HeaderCheck[]; score: number; grade: string; extras: string[] } {
  const get = (name: string) => headers[name.toLowerCase()] ?? null;
  const checks: HeaderCheck[] = [];
  const add = (header: string, weight: number, advice: string, judge?: (value: string) => number) => {
    const value = get(header);
    const earned = value === null ? 0 : Math.round(weight * (judge ? judge(value) : 1));
    checks.push({ header, present: value !== null, value, weight, earned, advice });
  };

  add("Content-Security-Policy", 30, "A CSP is the single biggest win against cross-site scripting. Start with default-src 'self'.", (v) =>
    /unsafe-inline|unsafe-eval/i.test(v) ? 0.5 : /default-src|script-src/i.test(v) ? 1 : 0.6,
  );
  add("Strict-Transport-Security", 20, "Send max-age=31536000; includeSubDomains so browsers refuse plain HTTP.", (v) => {
    const age = Number(/max-age=(\d+)/i.exec(v)?.[1] ?? 0);
    return age >= 31_536_000 ? 1 : age >= 86_400 ? 0.6 : 0.3;
  });
  add("X-Content-Type-Options", 10, "Set it to nosniff so the browser trusts your Content-Type.", (v) => (/nosniff/i.test(v) ? 1 : 0.3));
  add("X-Frame-Options", 10, "DENY or SAMEORIGIN, unless your CSP already sets frame-ancestors.", (v) =>
    /deny|sameorigin/i.test(v) ? 1 : 0.4,
  );
  add("Referrer-Policy", 10, "strict-origin-when-cross-origin is a good default.", (v) => (/no-referrer|strict-origin/i.test(v) ? 1 : 0.5));
  add("Permissions-Policy", 10, "Turn off the APIs you do not use: camera=(), microphone=(), geolocation=().");
  add("Cross-Origin-Opener-Policy", 5, "same-origin isolates your window from anything that opens it.", (v) => (/same-origin/i.test(v) ? 1 : 0.5));
  add("Cross-Origin-Resource-Policy", 5, "same-origin or same-site stops other pages embedding your responses.");

  // X-Frame-Options is redundant when the CSP already covers framing, so do not punish twice.
  const csp = get("Content-Security-Policy") ?? "";
  if (/frame-ancestors/i.test(csp)) {
    const xfo = checks.find((c) => c.header === "X-Frame-Options");
    if (xfo) xfo.earned = xfo.weight;
  }

  const extras: string[] = [];
  if (!https) extras.push("This URL is plain HTTP, so none of these headers can be trusted in transit.");
  if (get("Server")) extras.push(`The Server header advertises "${get("Server")}" — consider removing it.`);
  if (get("X-Powered-By")) extras.push(`X-Powered-By advertises "${get("X-Powered-By")}" — consider removing it.`);
  if (get("Access-Control-Allow-Origin") === "*") extras.push("Access-Control-Allow-Origin is *, which is fine for public data and dangerous for anything else.");

  const total = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.reduce((sum, c) => sum + c.earned, 0);
  const score = Math.round((earned / total) * 100 * (https ? 1 : 0.7));
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : score >= 20 ? "E" : "F";
  return { checks, score, grade, extras };
}

export const headerGraderExecutor: Executor = (input, _options, ctx) =>
  runNetTool("http-security-header-grader", async () => {
    rateLimit(ctx?.clientIp ?? "local", { limit: 20, windowMs: 60_000 });
    const raw = requireText(input, "a website address");
    const target = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
    const response = await safeFetch(target, { method: "GET", maxBytes: 64 * 1024, timeoutMs: 15_000, signal: ctx?.signal });
    const report = gradeHeaders(response.headers, new URL(response.url).protocol === "https:");
    const missing = report.checks.filter((c) => !c.present);
    return {
      ok: true,
      output: {
        url: response.url,
        status: response.status,
        ...report,
        headers: response.headers,
        result: `${report.grade} (${report.score}/100)`,
      },
      summary: `Grade ${report.grade} — ${report.score} out of 100. ${missing.length === 0 ? "Every header this tool checks is present." : `Missing: ${missing.map((c) => c.header).join(", ")}.`}`,
      files: [jsonFile("security-headers.json", { url: response.url, ...report })],
    };
  });

// ---- sitemap & robots.txt validator -----------------------------------------------------------

export interface RobotsReport {
  url: string;
  found: boolean;
  status: number;
  groups: { userAgents: string[]; allow: string[]; disallow: string[]; crawlDelay: number | null }[];
  sitemaps: string[];
  problems: string[];
}

export function parseRobots(text: string, url: string, status: number): RobotsReport {
  const groups: RobotsReport["groups"] = [];
  const sitemaps: string[] = [];
  const problems: string[] = [];
  let current: RobotsReport["groups"][number] | null = null;
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      problems.push(`Line ${index + 1}: "${rawLine.trim().slice(0, 60)}" is not a directive.`);
      continue;
    }
    const field = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (field === "user-agent") {
      if (!current || current.allow.length > 0 || current.disallow.length > 0 || current.crawlDelay !== null) {
        current = { userAgents: [], allow: [], disallow: [], crawlDelay: null };
        groups.push(current);
      }
      current.userAgents.push(value || "*");
    } else if (field === "sitemap") {
      sitemaps.push(value);
    } else if (field === "crawl-delay") {
      if (current) current.crawlDelay = Number(value) || null;
    } else if (field === "allow" || field === "disallow") {
      if (!current) {
        problems.push(`Line ${index + 1}: ${field} before any User-agent line, so most crawlers ignore it.`);
        continue;
      }
      current[field].push(value);
    }
  }
  if (status === 200 && groups.length === 0 && sitemaps.length === 0) {
    problems.push("This robots.txt has no rules in it at all.");
  }
  if (status === 200 && sitemaps.length === 0) problems.push("No Sitemap: line — adding one helps crawlers find your pages.");
  if (groups.some((g) => g.userAgents.includes("*") && g.disallow.includes("/"))) {
    problems.push('A "Disallow: /" for all user agents blocks your whole site from search engines.');
  }
  return { url, found: status === 200, status, groups, sitemaps, problems };
}

export interface SitemapReport {
  url: string;
  found: boolean;
  status: number;
  kind: "urlset" | "sitemapindex" | "unknown";
  urlCount: number;
  sampleUrls: string[];
  childSitemaps: string[];
  problems: string[];
}

export function parseSitemap(xml: string, url: string, status: number): SitemapReport {
  const problems: string[] = [];
  const kind: SitemapReport["kind"] = /<sitemapindex[\s>]/i.test(xml) ? "sitemapindex" : /<urlset[\s>]/i.test(xml) ? "urlset" : "unknown";
  const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]!);
  if (status === 200 && kind === "unknown") {
    problems.push("This does not look like a sitemap: no <urlset> or <sitemapindex> root element.");
  }
  if (!/^\s*<\?xml/.test(xml) && status === 200) problems.push("Missing the XML declaration on the first line.");
  if (status === 200 && locs.length === 0) problems.push("No <loc> entries — this sitemap lists nothing.");
  if (locs.length > 50_000) problems.push(`${locs.length} URLs — the limit per sitemap file is 50,000, so split it.`);
  const insecure = locs.filter((l) => l.startsWith("http://"));
  if (insecure.length > 0) problems.push(`${insecure.length} URL${insecure.length === 1 ? "" : "s"} use plain http://.`);
  const bad = locs.filter((l) => !/^https?:\/\//i.test(l));
  if (bad.length > 0) problems.push(`${bad.length} <loc> value${bad.length === 1 ? " is" : "s are"} not an absolute URL.`);
  const lastmods = [...xml.matchAll(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/gi)].map((m) => m[1]!);
  const badDates = lastmods.filter((d) => Number.isNaN(Date.parse(d)));
  if (badDates.length > 0) problems.push(`${badDates.length} <lastmod> value${badDates.length === 1 ? " is" : "s are"} not a valid date.`);

  return {
    url,
    found: status === 200,
    status,
    kind,
    urlCount: locs.length,
    sampleUrls: locs.slice(0, 20),
    childSitemaps: kind === "sitemapindex" ? locs.slice(0, 50) : [],
    problems,
  };
}

export const sitemapValidatorExecutor: Executor = (input, options, ctx) =>
  runNetTool("sitemap-and-robots-validator", async () => {
    rateLimit(ctx?.clientIp ?? "local", { limit: 15, windowMs: 60_000 });
    const raw = requireText(input, "a website address");
    const base = parseSafeUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    const fetchText = async (path: string) => {
      const response = await safeFetch(new URL(path, base).toString(), {
        maxBytes: 4 * 1024 * 1024,
        timeoutMs: 20_000,
        signal: ctx?.signal,
      });
      return { text: decodeBody(response), status: response.status, url: response.url };
    };

    const robotsRaw = await fetchText("/robots.txt").catch((err: unknown) => {
      if (err instanceof Error && /offline|reach/i.test(err.message)) throw err;
      return { text: "", status: 0, url: new URL("/robots.txt", base).toString() };
    });
    const robots = parseRobots(robotsRaw.text, robotsRaw.url, robotsRaw.status);

    const explicit = optString(options, "sitemap", "").trim();
    const sitemapUrl = explicit !== "" ? explicit : (robots.sitemaps[0] ?? new URL("/sitemap.xml", base).toString());
    const sitemapRaw = await fetchText(sitemapUrl).catch(() => ({ text: "", status: 0, url: sitemapUrl }));
    const sitemap = parseSitemap(sitemapRaw.text, sitemapRaw.url, sitemapRaw.status);

    const problems = [...robots.problems, ...sitemap.problems];
    return {
      ok: true,
      output: { robots, sitemap, problems, result: `${problems.length} problems` },
      summary: `robots.txt ${robots.found ? `found, ${plural(robots.groups.length, "rule group")}` : `not found (HTTP ${robots.status || "no answer"})`}. Sitemap ${sitemap.found ? `found, ${plural(sitemap.urlCount, "URL")}` : `not found (HTTP ${sitemap.status || "no answer"})`}. ${problems.length === 0 ? "No problems spotted." : `${plural(problems.length, "problem")}: ${problems[0]}`}`,
      files: [jsonFile("sitemap-robots.json", { robots, sitemap })],
    };
  });

// ---- email / MX validator ---------------------------------------------------------------------

/** A pragmatic syntax check: RFC 5322 in full is not worth implementing for this. */
export const EMAIL_SYNTAX = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "throwawaymail.com",
  "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com",
  "maildrop.cc", "temp-mail.org", "fakeinbox.com", "mytemp.email",
]);

const ROLE_LOCAL_PARTS = new Set([
  "admin", "administrator", "info", "support", "sales", "contact", "help", "noreply", "no-reply",
  "postmaster", "webmaster", "abuse", "billing", "hr", "jobs", "marketing", "office",
]);

export const emailValidatorExecutor: Executor = (input, _options, ctx) =>
  runNetTool("email-mx-validator", async () => {
    rateLimit(ctx?.clientIp ?? "local", { limit: 30, windowMs: 60_000 });
    const address = requireText(input, "an email address").trim();
    const syntaxOk = EMAIL_SYNTAX.test(address) && address.length <= 254;
    const notes: string[] = [];
    if (!syntaxOk) {
      return {
        ok: true,
        output: { address, syntaxValid: false, deliverable: false, result: "invalid syntax" },
        summary: `"${address}" is not a valid email address. Check for a missing @, a stray space, or a domain with no dot in it.`,
        files: [],
      };
    }
    const [localPart, domain] = [address.slice(0, address.lastIndexOf("@")), address.slice(address.lastIndexOf("@") + 1)];
    if (localPart.length > 64) notes.push("The part before the @ is longer than the 64-character limit.");
    if (DISPOSABLE_DOMAINS.has(domain.toLowerCase())) notes.push("This is a known disposable-address domain.");
    if (ROLE_LOCAL_PARTS.has(localPart.toLowerCase())) notes.push("This is a role address, not a person — expect a shared inbox.");
    if (localPart.includes("+")) notes.push("The + suffix is a tag; mail still reaches the base address.");

    const resolver = new Resolver({ timeout: 8000, tries: 2 });
    const mx = await resolver.resolveMx(domain).catch((err: unknown) => {
      if (err instanceof Error && /ENOTFOUND|NXDOMAIN|ENODATA/i.test(err.message)) return [];
      throw offline(err);
    });
    const sorted = [...mx].sort((a, b) => a.priority - b.priority);
    // A domain with no MX but an A record still accepts mail per RFC 5321 §5.1, so say so rather
    // than calling it undeliverable.
    const deliverable = sorted.length > 0;
    return {
      ok: true,
      output: {
        address,
        localPart,
        domain,
        syntaxValid: true,
        deliverable,
        mx: sorted,
        notes,
        result: deliverable ? `${domain} accepts mail via ${sorted[0]!.exchange}` : `${domain} has no MX records`,
      },
      summary: deliverable
        ? `Valid, and ${domain} accepts mail — ${plural(sorted.length, "mail server")}, primary ${sorted[0]!.exchange}.${notes.length ? ` ${notes[0]}` : ""}`
        : `The address is well-formed, but ${domain} publishes no MX records, so mail to it will probably bounce.${notes.length ? ` ${notes[0]}` : ""}`,
      files: [],
    };
  });

// ---- weather lookup ---------------------------------------------------------------------------

const WEATHER_CODES: Record<number, string> = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "freezing fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "light freezing drizzle", 57: "freezing drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 66: "light freezing rain", 67: "freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "light showers", 81: "showers", 82: "violent showers", 85: "light snow showers", 86: "snow showers",
  95: "thunderstorm", 96: "thunderstorm with light hail", 99: "thunderstorm with heavy hail",
};

export const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
export const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

export const weatherLookupExecutor: Executor = (input, options, ctx) =>
  runNetTool("weather-lookup", async () => {
    rateLimit(ctx?.clientIp ?? "local", { limit: 30, windowMs: 60_000 });
    const query = requireText(input, "a place, or coordinates like 51.5,-0.12").trim();
    const units = optEnum(options, "units", ["metric", "imperial"] as const, "metric");
    const days = optNumber(options, "days", 5, { min: 1, max: 16 });

    let latitude: number;
    let longitude: number;
    let label: string;
    const coords = /^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/.exec(query);
    if (coords) {
      latitude = Number(coords[1]);
      longitude = Number(coords[2]);
      if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        throw unsupported("Latitude must be between -90 and 90, longitude between -180 and 180.");
      }
      label = `${latitude}, ${longitude}`;
    } else {
      // Open-Meteo's geocoder: free, keyless, and the same service as the forecast, so one less
      // third party than pairing it with Nominatim would be.
      const geo = await safeFetch(`${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=1&language=en&format=json`, {
        timeoutMs: 15_000,
        maxBytes: 256 * 1024,
        signal: ctx?.signal,
      });
      const body = JSON.parse(decodeBody(geo) || "{}") as {
        results?: { latitude: number; longitude: number; name: string; country?: string; admin1?: string }[];
      };
      const hit = body.results?.[0];
      if (!hit) throw unsupported(`No place called "${query}" was found. Try adding the country, or use coordinates.`);
      latitude = hit.latitude;
      longitude = hit.longitude;
      label = [hit.name, hit.admin1, hit.country].filter(Boolean).join(", ");
    }

    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max",
      forecast_days: String(days),
      timezone: "auto",
      ...(units === "imperial" ? { temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch" } : {}),
    });
    const response = await safeFetch(`${FORECAST_URL}?${params.toString()}`, {
      timeoutMs: 20_000,
      maxBytes: 512 * 1024,
      signal: ctx?.signal,
    });
    const data = JSON.parse(decodeBody(response) || "{}") as {
      current?: Record<string, number>;
      current_units?: Record<string, string>;
      daily?: Record<string, (number | string)[]>;
      timezone?: string;
    };
    if (!data.current) throw failed("The weather service returned something unexpected. Try again in a moment.");

    const tempUnit = data.current_units?.temperature_2m ?? (units === "imperial" ? "°F" : "°C");
    const windUnit = data.current_units?.wind_speed_10m ?? (units === "imperial" ? "mph" : "km/h");
    const condition = WEATHER_CODES[data.current.weather_code ?? -1] ?? "unknown conditions";
    const forecast = (data.daily?.time ?? []).map((date, i) => ({
      date: String(date),
      condition: WEATHER_CODES[Number(data.daily?.weather_code?.[i] ?? -1)] ?? "unknown",
      high: data.daily?.temperature_2m_max?.[i] ?? null,
      low: data.daily?.temperature_2m_min?.[i] ?? null,
      precipitation: data.daily?.precipitation_sum?.[i] ?? null,
      rainChance: data.daily?.precipitation_probability_max?.[i] ?? null,
    }));

    return {
      ok: true,
      output: {
        place: label,
        latitude,
        longitude,
        timezone: data.timezone,
        current: { ...data.current, condition, temperatureUnit: tempUnit, windUnit },
        forecast,
        result: `${data.current.temperature_2m}${tempUnit}, ${condition}`,
      },
      summary: `${label}: ${data.current.temperature_2m}${tempUnit} and ${condition}, feels like ${data.current.apparent_temperature}${tempUnit}, wind ${data.current.wind_speed_10m} ${windUnit}. ${forecast[0] ? `Today ${forecast[0].low}–${forecast[0].high}${tempUnit}, ${forecast[0].rainChance ?? 0}% chance of rain.` : ""} Data from Open-Meteo, which needs no key and is free for this kind of use.`,
      files: [jsonFile(`${safeStem(label, "weather")}-weather.json`, { place: label, current: data.current, forecast })],
    };
  });

// ---- API request tester -----------------------------------------------------------------------

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

/** "Name: value" per line. Hop-by-hop and identity headers are not forwardable, so they are dropped. */
const BLOCKED_HEADERS = new Set([
  "host", "connection", "keep-alive", "transfer-encoding", "upgrade", "te", "trailer",
  "proxy-authorization", "proxy-authenticate", "content-length",
]);

export function parseHeaderLines(text: string): { headers: Record<string, string>; ignored: string[] } {
  const headers: Record<string, string> = {};
  const ignored: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const index = trimmed.indexOf(":");
    if (index <= 0) {
      ignored.push(trimmed.slice(0, 60));
      continue;
    }
    const name = trimmed.slice(0, index).trim().toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || BLOCKED_HEADERS.has(name)) {
      ignored.push(trimmed.slice(0, 60));
      continue;
    }
    headers[name] = trimmed.slice(index + 1).trim();
  }
  return { headers, ignored };
}

export const apiTesterExecutor: Executor = (input, options, ctx) =>
  runNetTool("api-request-tester", async () => {
    rateLimit(ctx?.clientIp ?? "local", { limit: 40, windowMs: 60_000 });
    const url = requireText(input, "a URL to call");
    const method = optEnum(options, "method", METHODS, "GET");
    const { headers, ignored } = parseHeaderLines(optString(options, "headers", ""));
    const bodyText = optString(options, "body", "");
    const sendBody = bodyText !== "" && method !== "GET" && method !== "HEAD";
    if (sendBody && headers["content-type"] === undefined) {
      // Guess only between the two that matter, and say which was chosen in the result.
      headers["content-type"] = bodyText.trim().startsWith("{") || bodyText.trim().startsWith("[")
        ? "application/json"
        : "text/plain; charset=utf-8";
    }
    const bearer = optString(options, "bearer", "").trim();
    if (bearer !== "") headers.authorization = `Bearer ${bearer}`;

    const response = await safeFetch(url, {
      method,
      headers,
      ...(sendBody ? { body: bodyText } : {}),
      timeoutMs: optNumber(options, "timeoutMs", 15_000, { min: 1000, max: 60_000 }),
      maxBytes: optNumber(options, "maxKb", 1024, { min: 1, max: 8192 }) * 1024,
      signal: ctx?.signal,
    });

    const text = decodeBody(response);
    const contentType = response.headers["content-type"] ?? "";
    let pretty = text;
    let parsed: unknown = undefined;
    if (/json/i.test(contentType) && text.trim() !== "") {
      try {
        parsed = JSON.parse(text);
        pretty = JSON.stringify(parsed, null, 2);
      } catch {
        // A wrong Content-Type is the server's problem, not ours — show the raw body.
      }
    }
    const family = Math.floor(response.status / 100);
    const verdict =
      family === 2 ? "succeeded" : family === 3 ? "redirected" : family === 4 ? "was rejected" : family === 5 ? "hit a server error" : "answered";
    return {
      ok: true,
      output: {
        request: { method, url: response.chain[0]?.url ?? url, headers, bodySent: sendBody, ignoredHeaders: ignored },
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        redirects: response.chain.slice(0, -1),
        elapsedMs: response.elapsedMs,
        bytes: response.body.length,
        truncated: response.truncated,
        json: parsed,
        body: pretty.slice(0, 200_000),
        result: `${response.status} ${response.statusText}`,
      },
      summary: `${method} ${verdict}: HTTP ${response.status} ${response.statusText} in ${response.elapsedMs} ms, ${response.body.length} bytes${response.truncated ? " (truncated)" : ""}${response.chain.length > 1 ? `, after ${plural(response.chain.length - 1, "redirect")}` : ""}.${ignored.length ? ` ${plural(ignored.length, "header")} could not be sent.` : ""}`,
      files: [
        textFile(
          `response.${/json/i.test(contentType) ? "json" : "txt"}`,
          /json/i.test(contentType) ? MIME.json : MIME.txt,
          pretty === "" ? "(empty body)\n" : pretty + "\n",
        ),
      ],
    };
  });

export { optBool };
