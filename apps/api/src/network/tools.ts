// The nine Network / Information tools (17-online-media-network-tools.md, Features §13).
//
// Every one of them follows the same shape: read the typed input, do one bounded lookup, and
// return three things — a JSON object for the page, one sentence a person can read, and a plain
// text report to download. All of it happens inside `runNetTool`, so a failure here is a message,
// never a crash, and never anything another tool can notice.
import type { Executor } from "@onestop/tool-registry";
import type { ExecContext } from "@onestop/types";
import { describeUserAgent, parseUserAgent } from "../dev-utils/userAgent.ts";
import {
  MIME,
  jsonFile,
  optBool,
  optEnum,
  optNumber,
  plural,
  rateLimit,
  reportText,
  requireText,
  runNetTool,
  safeStem,
  textFile,
  unsupported,
} from "./common.ts";
import {
  DEFAULT_RECORD_TYPES,
  RECORD_TYPES,
  formatAnswer,
  lookupDns,
  normalizeHost,
  reverseLookup,
  type RecordType,
} from "./dns.ts";
import { geocode, geolocate, parseCoordinates, reverseGeocode } from "./geo.ts";
import { classifyIp, parseIp } from "./ipAddress.ts";
import { describeSite, lookupSite } from "./siteInfo.ts";
import { safeFetch } from "./ssrf.ts";
import { whois } from "./whois.ts";

/**
 * Third parties are doing OneStop a favour by answering at all, so each tool gets a modest
 * per-caller budget. Guests on one shared address share a bucket; that is the right trade for a
 * personal instance, and it is generous enough that nobody using the tool normally will meet it.
 */
const BUDGET = { limit: 20, windowMs: 60_000 };

function guard(toolId: string, ctx?: ExecContext): void {
  rateLimit(`${toolId}:${ctx?.clientIp ?? "local"}`, BUDGET);
}

// ---- §13.1 IP Address Lookup --------------------------------------------------------------------

export const ipAddressLookupExecutor: Executor = (input, options, ctx) =>
  runNetTool("ip-address-lookup", async () => {
    guard("ip-address-lookup", ctx);
    const raw = requireText(input, "an IP address");
    const ip = parseIp(raw);
    if (!ip) {
      throw unsupported(
        "That is not a valid IP address. Try something like 8.8.8.8 or 2606:4700::1111.",
      );
    }
    const cls = classifyIp(ip);
    const geo = geolocate(ip.text);
    const wantReverse = optBool(options, "reverseDns", true) && cls.routable;
    const wantWhois = optBool(options, "whois", true) && cls.routable;

    const hostnames = wantReverse ? await reverseLookup(ip.text).catch(() => []) : [];
    let registry: Record<string, unknown> | null = null;
    if (wantWhois) {
      try {
        const record = await whois(ip.text);
        registry = {
          server: record.hops[record.hops.length - 1]?.server ?? null,
          ...record.fields,
        };
      } catch (err) {
        console.error("[network:ip-address-lookup] the WHOIS step did not answer", err);
        registry = null;
      }
    }

    const output = {
      ip: ip.text,
      version: `IPv${ip.version}`,
      scope: cls.scope,
      publiclyRoutable: cls.routable,
      description: cls.description,
      hostnames,
      country: geo.country?.name ?? null,
      countryCode: geo.country?.cc ?? null,
      registry,
      geolocation: geo,
    };

    const summary = cls.routable
      ? `${ip.text} is ${cls.description}${geo.country ? `, allocated to ${geo.country.name}` : ""}${
          hostnames[0] ? `, and reverse-resolves to ${hostnames[0]}` : ""
        }.`
      : `${ip.text} is ${cls.description}.`;

    const report = reportText(`IP address lookup — ${ip.text}`, [
      ["Address", ip.text],
      ["Version", `IPv${ip.version}`],
      ["Scope", cls.scope],
      ["Country", geo.country ? `${geo.country.name} (${geo.country.cc})` : ""],
      ["Reverse DNS", hostnames],
      ["Network", registry?.network ?? ""],
      ["Organisation", registry?.organisation ?? registry?.netName ?? ""],
      ["Abuse contact", registry?.abuseContact ?? ""],
    ]);

    return {
      ok: true,
      output,
      summary,
      files: [
        textFile(`${safeStem(ip.text, "ip")}-lookup.txt`, MIME.txt, report),
        jsonFile(`${safeStem(ip.text, "ip")}-lookup.json`, output),
      ],
    };
  });

// ---- §13.2 Public IP Detector ------------------------------------------------------------------

/** Free, key-less "what address did this request come from" services, tried in order. */
const ECHO_SERVICES = ["https://api.ipify.org?format=json", "https://ifconfig.co/json"];

async function askEchoService(signal?: AbortSignal): Promise<string | null> {
  for (const service of ECHO_SERVICES) {
    try {
      const response = await safeFetch(service, {
        maxBytes: 8 * 1024,
        timeoutMs: 8000,
        headers: { accept: "application/json" },
        ...(signal ? { signal } : {}),
      });
      const body = new TextDecoder().decode(response.body);
      const found = /\b(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]{6,})\b/i.exec(
        (JSON.parse(body) as { ip?: string }).ip ?? body,
      )?.[1];
      if (found && parseIp(found)) return parseIp(found)!.text;
    } catch (err) {
      console.error(`[network:public-ip-detector] ${service} did not answer`, err);
    }
  }
  return null;
}

export const publicIpDetectorExecutor: Executor = (_input, _options, ctx) =>
  runNetTool("public-ip-detector", async () => {
    guard("public-ip-detector", ctx);
    const seen = ctx?.clientIp ? parseIp(ctx.clientIp) : null;
    const seenClass = seen ? classifyIp(seen) : null;

    // When OneStop runs on the same machine or LAN as the browser, the address it sees is a
    // private one and says nothing about the public Internet. Asking a free echo service gives
    // the address that machine actually leaves the network with, which is the honest answer.
    if (seen && seenClass?.routable) {
      const geo = geolocate(seen.text);
      const output = {
        ip: seen.text,
        version: `IPv${seen.version}`,
        source: "request",
        country: geo.country?.name ?? null,
        countryCode: geo.country?.cc ?? null,
        note: "This is the address OneStop saw your request arrive from.",
      };
      return {
        ok: true,
        output,
        summary: `Your public IP address is ${seen.text}${geo.country ? ` (${geo.country.name})` : ""}.`,
        files: [textFile("public-ip.txt", MIME.txt, `${seen.text}\n`)],
      };
    }

    const egress = await askEchoService(ctx?.signal);
    if (!egress) {
      throw unsupported(
        "Your public address could not be determined. OneStop is running on your own network, and the services that report it did not answer.",
      );
    }
    const geo = geolocate(egress);
    const output = {
      ip: egress,
      version: `IPv${parseIp(egress)!.version}`,
      source: "echo-service",
      country: geo.country?.name ?? null,
      countryCode: geo.country?.cc ?? null,
      seenByOneStop: seen?.text ?? null,
      note: "OneStop is running on your own network, so this is the address this machine leaves the Internet from, reported by a free public service.",
    };
    return {
      ok: true,
      output,
      summary: `This machine reaches the Internet from ${egress}${geo.country ? ` (${geo.country.name})` : ""}.`,
      files: [textFile("public-ip.txt", MIME.txt, `${egress}\n`)],
    };
  });

// ---- §13.3 IP Geolocation ----------------------------------------------------------------------

export const ipGeolocationExecutor: Executor = (input, _options, ctx) =>
  runNetTool("ip-geolocation", async () => {
    guard("ip-geolocation", ctx);
    const geo = geolocate(requireText(input, "an IP address"));
    const where = geo.city
      ? `${geo.city}${geo.country ? `, ${geo.country.name}` : ""}`
      : (geo.country?.name ?? null);
    const summary = where
      ? `${geo.ip} is registered in ${where}. ${geo.note}`
      : `${geo.ip} has no location. ${geo.note}`;
    const report = reportText(`IP geolocation — ${geo.ip}`, [
      ["Address", geo.ip],
      ["Country", geo.country ? `${geo.country.name} (${geo.country.cc})` : ""],
      ["Region", geo.region ?? ""],
      ["City", geo.city ?? ""],
      ["Latitude", geo.latitude ?? ""],
      ["Longitude", geo.longitude ?? ""],
      ["Accuracy", geo.accuracy],
      ["Source", geo.source],
      ["Data date", geo.dataDate],
      ["Note", geo.note],
    ]);
    return {
      ok: true,
      output: geo as unknown as Record<string, unknown>,
      summary,
      files: [
        textFile(`${safeStem(geo.ip, "ip")}-location.txt`, MIME.txt, report),
        jsonFile(`${safeStem(geo.ip, "ip")}-location.json`, geo),
      ],
    };
  });

// ---- §13.4 Location Lookup ---------------------------------------------------------------------

export const locationLookupExecutor: Executor = (input, options, ctx) =>
  runNetTool("location-lookup", async () => {
    guard("location-lookup", ctx);
    const query = requireText(input, "a place or address");
    const limit = optNumber(options, "results", 5, { min: 1, max: 10 });
    const places = await geocode(query, limit);
    if (places.length === 0) {
      throw unsupported(
        `Nothing was found for "${query}". Try a fuller address, or a nearby town.`,
      );
    }
    const best = places[0]!;
    const output = { query, count: places.length, best, results: places };
    const report = reportText(`Location lookup — ${query}`, [
      ["Query", query],
      ["Best match", best.displayName],
      ["Latitude", best.latitude],
      ["Longitude", best.longitude],
      ["Type", best.type ?? ""],
      ["Country", best.countryCode ?? ""],
      ["Coordinates", `${best.latitude.toFixed(6)}, ${best.longitude.toFixed(6)}`],
      [
        "Map",
        `https://www.openstreetmap.org/?mlat=${best.latitude}&mlon=${best.longitude}#map=15/${best.latitude}/${best.longitude}`,
      ],
      ["Other matches", places.length - 1],
    ]);
    return {
      ok: true,
      output,
      summary: `${best.displayName} is at ${best.latitude.toFixed(5)}, ${best.longitude.toFixed(5)}${
        places.length > 1 ? ` (${plural(places.length - 1, "other match")} found)` : ""
      }.`,
      files: [
        textFile(`${safeStem(query, "place")}.txt`, MIME.txt, report),
        jsonFile(`${safeStem(query, "place")}.json`, output),
      ],
    };
  });

// ---- §13.5 Coordinates Lookup ------------------------------------------------------------------

export const coordinatesLookupExecutor: Executor = (input, _options, ctx) =>
  runNetTool("coordinates-lookup", async () => {
    guard("coordinates-lookup", ctx);
    const raw = requireText(input, "a pair of coordinates");
    const point = parseCoordinates(raw);
    if (!point) {
      throw unsupported(
        'That is not a pair of coordinates. Try "48.8584, 2.2945" or 48°51\'29"N 2°17\'40"E.',
      );
    }
    const place = await reverseGeocode(point.latitude, point.longitude);
    if (!place) {
      const output = {
        ...point,
        place: null,
        note: "These coordinates are not near any named place — most likely open water or unmapped ground.",
      };
      return {
        ok: true,
        output,
        summary: `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)} is not near any named place.`,
        files: [jsonFile("coordinates.json", output)],
      };
    }
    const output = { ...point, place, address: place.address };
    const report = reportText(`Coordinates lookup — ${point.latitude}, ${point.longitude}`, [
      ["Latitude", point.latitude],
      ["Longitude", point.longitude],
      ["Place", place.displayName],
      ["Type", place.type ?? ""],
      ["Country", place.countryCode ?? ""],
      ...Object.entries(place.address).map(
        ([k, v]) => [k.replace(/_/g, " "), v] as [string, unknown],
      ),
    ]);
    return {
      ok: true,
      output,
      summary: `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)} is ${place.displayName}.`,
      files: [textFile("coordinates.txt", MIME.txt, report), jsonFile("coordinates.json", output)],
    };
  });

// ---- §13.6 User-Agent Lookup -------------------------------------------------------------------

/**
 * The one tool in this file that needs no network: it parses a string the user pasted. It reuses
 * phase 12's parser rather than growing a second one — the difference between the two tools is
 * whose string it is, not how it is read (PROGRESS.md "Open Questions", resolved in phase 03).
 */
export const userAgentLookupExecutor: Executor = (input) =>
  runNetTool("user-agent-lookup", async () => {
    const raw = requireText(input, "a user-agent string");
    const parsed = parseUserAgent(raw);
    const report = reportText("User-agent lookup", [
      ["User agent", parsed.raw],
      ["Browser", parsed.browser ? `${parsed.browser.name} ${parsed.browser.version}` : "unknown"],
      ["Engine", parsed.engine ? `${parsed.engine.name} ${parsed.engine.version}` : "unknown"],
      ["Operating system", parsed.os ? `${parsed.os.name} ${parsed.os.version}` : "unknown"],
      ["Device", parsed.device.type],
      ["Vendor", parsed.device.vendor ?? ""],
      ["Model", parsed.device.model ?? ""],
      ["Bot", parsed.bot ? "yes" : "no"],
    ]);
    return {
      ok: true,
      output: parsed as unknown as Record<string, unknown>,
      summary: describeUserAgent(parsed),
      files: [textFile("user-agent.txt", MIME.txt, report), jsonFile("user-agent.json", parsed)],
    };
  });

// ---- §13.7 DNS Lookup --------------------------------------------------------------------------

export const dnsLookupExecutor: Executor = (input, options, ctx) =>
  runNetTool("dns-lookup", async () => {
    guard("dns-lookup", ctx);
    const host = requireText(input, "a domain name");
    const choice = optEnum(options, "records", ["common", "all", "one"] as const, "common");
    const single = optEnum(options, "recordType", RECORD_TYPES, "A");
    const types: RecordType[] =
      choice === "all" ? [...RECORD_TYPES] : choice === "one" ? [single] : DEFAULT_RECORD_TYPES;

    const report = await lookupDns(host, types);
    const found = report.answers.filter((a) => a.records.length > 0);
    const total = found.reduce((sum, a) => sum + a.records.length, 0);

    const lines = [
      `DNS records for ${report.name}`,
      "=".repeat(`DNS records for ${report.name}`.length),
      "",
    ];
    for (const answer of report.answers) {
      const values = formatAnswer(answer);
      lines.push(`${answer.type}:`);
      if (answer.error) lines.push(`  ${answer.error}`);
      else if (values.length === 0) lines.push("  (none)");
      else lines.push(...values.map((v) => `  ${v}`));
      lines.push("");
    }

    const output = {
      name: report.name,
      servers: report.servers,
      records: Object.fromEntries(report.answers.map((a) => [a.type, formatAnswer(a)])),
      answers: report.answers,
      elapsedMs: report.elapsedMs,
    };
    return {
      ok: true,
      output,
      summary:
        total === 0
          ? `${report.name} has no records of the types asked for.`
          : `${report.name} has ${plural(total, "record")} across ${plural(found.length, "type")}.`,
      files: [
        textFile(`${safeStem(report.name, "dns")}-dns.txt`, MIME.txt, `${lines.join("\n")}\n`),
        jsonFile(`${safeStem(report.name, "dns")}-dns.json`, output),
      ],
    };
  });

// ---- §13.8 WHOIS Lookup ------------------------------------------------------------------------

export const whoisLookupExecutor: Executor = (input, options, ctx) =>
  runNetTool("whois-lookup", async () => {
    guard("whois-lookup", ctx);
    const query = requireText(input, "a domain name or IP address");
    const record = await whois(query);
    const f = record.fields;
    const output = {
      query: record.query,
      kind: record.kind,
      servers: record.hops.map((h) => h.server),
      fields: f,
      ...(optBool(options, "raw", true) ? { raw: record.text } : {}),
    };

    const summary =
      record.kind === "domain"
        ? `${record.query}${f.registrar ? ` is registered with ${f.registrar}` : " has a registry record"}${
            f.expires ? `, and expires on ${f.expires.slice(0, 10)}` : ""
          }.`
        : `${record.query} belongs to ${f.organisation ?? f.netName ?? "an unnamed network"}${
            f.network ? ` (${f.network})` : ""
          }.`;

    const report = reportText(`WHOIS — ${record.query}`, [
      ["Query", record.query],
      ["Servers asked", record.hops.map((h) => h.server)],
      ["Domain", f.domain ?? ""],
      ["Registrar", f.registrar ?? ""],
      ["Registered", f.registered ?? ""],
      ["Updated", f.updated ?? ""],
      ["Expires", f.expires ?? ""],
      ["Status", f.status ?? ""],
      ["Name servers", f.nameServers ?? ""],
      ["Registrant", f.registrant ?? ""],
      ["Country", f.registrantCountry ?? f.country ?? ""],
      ["Network", f.network ?? ""],
      ["Organisation", f.organisation ?? ""],
      ["Abuse contact", f.abuseContact ?? ""],
    ]);

    return {
      ok: true,
      output,
      summary,
      files: [
        textFile(
          `${safeStem(record.query, "whois")}-whois.txt`,
          MIME.txt,
          `${report}\n${record.text}\n`,
        ),
        jsonFile(`${safeStem(record.query, "whois")}-whois.json`, { ...output, raw: record.text }),
      ],
    };
  });

// ---- §13.9 Website Information Lookup ----------------------------------------------------------

export const websiteInformationLookupExecutor: Executor = (input, options, ctx) =>
  runNetTool("website-information-lookup", async () => {
    guard("website-information-lookup", ctx);
    let target = requireText(input, "a website address");
    if (!/^https?:\/\//i.test(target)) target = `https://${target}`;

    const info = await lookupSite(target, {
      certificate: optBool(options, "certificate", true),
      ...(ctx?.signal ? { signal: ctx.signal } : {}),
    });

    const output: Record<string, unknown> = { ...info };
    if (optBool(options, "dns", false)) {
      try {
        const dns = await lookupDns(normalizeHost(info.finalUrl));
        output.dns = Object.fromEntries(dns.answers.map((a) => [a.type, formatAnswer(a)]));
      } catch (err) {
        console.error("[network:website-information-lookup] the DNS step did not answer", err);
      }
    }

    const report = reportText(`Website information — ${info.finalUrl}`, [
      ["URL", info.url],
      ["Final URL", info.finalUrl],
      ["Status", `${info.status} ${info.statusText}`],
      ["Redirects", info.redirects.map((r) => `${r.status} ${r.url}`)],
      ["Addresses", info.addresses],
      ["Title", info.title ?? ""],
      ["Description", info.description ?? ""],
      ["Language", info.language ?? ""],
      ["Server", info.server ?? ""],
      ["Powered by", info.poweredBy ?? ""],
      ["Content type", info.contentType ?? ""],
      ["Generator", info.generator ?? ""],
      ["Canonical", info.canonical ?? ""],
      [
        "Certificate",
        info.certificate
          ? `${info.certificate.issuer ?? "unknown issuer"}, expires ${info.certificate.validTo}`
          : "",
      ],
      ["Response time", `${info.responseTimeMs} ms`],
      ...Object.entries(info.securityHeaders).map(
        ([k, v]) => [k, v ?? "(not set)"] as [string, unknown],
      ),
    ]);

    const stem = safeStem(new URL(info.finalUrl).hostname, "site");
    return {
      ok: true,
      output,
      summary: describeSite(info),
      files: [
        textFile(`${stem}-info.txt`, MIME.txt, report),
        jsonFile(`${stem}-info.json`, output),
      ],
    };
  });

/** Every executor this file owns, in the order Features §13 lists them. */
export const NETWORK_EXECUTORS = [
  ["ip-address-lookup", ipAddressLookupExecutor],
  ["public-ip-detector", publicIpDetectorExecutor],
  ["ip-geolocation", ipGeolocationExecutor],
  ["location-lookup", locationLookupExecutor],
  ["coordinates-lookup", coordinatesLookupExecutor],
  ["user-agent-lookup", userAgentLookupExecutor],
  ["dns-lookup", dnsLookupExecutor],
  ["whois-lookup", whoisLookupExecutor],
  ["website-information-lookup", websiteInformationLookupExecutor],
] as const;
