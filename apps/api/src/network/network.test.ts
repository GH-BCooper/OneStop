// Tests for the Network / Information tools (17-online-media-network-tools.md).
//
// The build file's rule is that CI never touches a real network: DNS, WHOIS and HTTP are all
// replaced here, and the known-good values (8.8.8.8, example.com) are asserted against those
// replacements. What is exercised for real is everything that is OneStop's own code — the address
// parser, the offline country tables, the MaxMind reader (against MaxMind's own published test
// database), the SSRF rules, the WHOIS parser and every tool's error handling.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecContext, ExecResult } from "@onestop/types";
import { recordOfflineCoverage } from "../../../../tests/offline/coverage.ts";

const resolveMock = vi.fn();
const resolvePtrMock = vi.fn();
const lookupMock = vi.fn();

// node:dns is the one thing these tools cannot be tested without replacing.
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
  Resolver: class {
    private servers = ["9.9.9.9"];
    getServers() {
      return this.servers;
    }
    setServers(next: string[]) {
      this.servers = next;
    }
    resolve(name: string, type: string) {
      return resolveMock(name, type);
    }
    resolvePtr(name: string) {
      return resolvePtrMock(name);
    }
  },
}));

const { NETWORK_EXECUTORS } = await import("./tools.ts");
const { resetRateLimits } = await import("./common.ts");
const { classifyIp, canonicalIpv6, parseIp, parseIpv4, parseIpv6, reverseName } =
  await import("./ipAddress.ts");
const { geolocate, parseCoordinates } = await import("./geo.ts");
const { lookupCity, mmdbStatus, resetMmdbCache } = await import("./mmdb.ts");
const { checkUrl, parseSafeUrl, safeFetch } = await import("./ssrf.ts");
const { parseWhois, referralFrom, setWhoisTransport } = await import("./whois.ts");
const { readPageMeta, lookupSite } = await import("./siteInfo.ts");
const { normalizeHost } = await import("./dns.ts");

// ---- helpers ----------------------------------------------------------------------------------

const tool = (id: string) => NETWORK_EXECUTORS.find(([k]) => k === id)![1];

const ctx = (clientIp: string | null = null): ExecContext => ({
  jobId: "t",
  clientIp,
  readFile: async () => {
    throw new Error("phase-17 tools take no files");
  },
});

async function run(
  id: string,
  input: string | null,
  options: Record<string, unknown> = {},
  context: ExecContext = ctx(),
): Promise<ExecResult> {
  return tool(id)(input, options, context);
}

function ok(result: ExecResult): Extract<ExecResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected success, got ${result.code}: ${result.message}`);
  return result;
}

function failure(result: ExecResult): Extract<ExecResult, { ok: false }> {
  if (result.ok) throw new Error("expected failure");
  return result;
}

/** A fetch stand-in that answers from a table of URL -> response. */
function fakeFetch(
  routes: Record<string, { status?: number; headers?: Record<string, string>; body?: string }>,
) {
  return vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const route = routes[url] ?? routes[url.replace(/\/$/, "")];
    if (!route) throw Object.assign(new TypeError("fetch failed"), { code: "ENOTFOUND" });
    return new Response(route.body ?? "", {
      status: route.status ?? 200,
      headers: route.headers ?? { "content-type": "text/html; charset=utf-8" },
    });
  }) as unknown as typeof fetch;
}

const DNS_ANSWERS: Record<string, unknown> = {
  A: ["93.184.216.34"],
  AAAA: ["2606:2800:220:1:248:1893:25c8:1946"],
  MX: [{ priority: 0, exchange: "." }],
  NS: ["a.iana-servers.net", "b.iana-servers.net"],
  TXT: [["v=spf1 -all"]],
  SOA: { nsname: "ns.icann.org", hostmaster: "noc.dns.icann.org", serial: 2024081601 },
};

beforeEach(() => {
  resetRateLimits();
  resetMmdbCache();
  delete process.env.GEOIP_MMDB;
  resolveMock.mockReset();
  resolvePtrMock.mockReset();
  lookupMock.mockReset();
  setWhoisTransport(null);

  resolveMock.mockImplementation(async (name: string, type: string) => {
    if (name !== "example.com") {
      throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    }
    const answer = DNS_ANSWERS[type];
    if (!answer) throw Object.assign(new Error("no data"), { code: "ENODATA" });
    return answer;
  });
  resolvePtrMock.mockResolvedValue(["dns.google"]);
  lookupMock.mockImplementation(async (host: string) => {
    if (host === "example.com") return [{ address: "93.184.216.34", family: 4 }];
    if (host === "internal.test") return [{ address: "127.0.0.1", family: 4 }];
    if (host === "api.ipify.org" || host === "ifconfig.co")
      return [{ address: "104.26.12.205", family: 4 }];
    throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
  });
});

afterEach(() => {
  setWhoisTransport(null);
  vi.unstubAllGlobals();
});

// ---- address parsing ---------------------------------------------------------------------------

describe("IP addresses", () => {
  it("parses IPv4 and rejects what only looks like it", () => {
    expect(parseIpv4("8.8.8.8")?.value).toBe(134744072n);
    expect(parseIpv4("008.8.8.8")?.text).toBe("8.8.8.8");
    expect(parseIpv4("256.1.1.1")).toBeNull();
    expect(parseIpv4("1.2.3")).toBeNull();
  });

  it("parses and canonicalises IPv6, including the IPv4-mapped form", () => {
    expect(parseIpv6("2606:4700:4700:0000:0000:0000:0000:1111")?.text).toBe("2606:4700:4700::1111");
    expect(parseIpv6("::1")?.value).toBe(1n);
    expect(parseIpv6("::ffff:127.0.0.1")?.text).toBe("::ffff:7f00:1");
    expect(parseIpv6("fe80::1%eth0")?.text).toBe("fe80::1");
    expect(parseIpv6("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(canonicalIpv6(0n)).toBe("::");
  });

  it("knows which addresses are on the public Internet", () => {
    const scope = (text: string) => classifyIp(parseIp(text)!).scope;
    expect(scope("8.8.8.8")).toBe("public");
    expect(scope("127.0.0.1")).toBe("loopback");
    expect(scope("10.0.0.1")).toBe("private");
    expect(scope("192.168.1.1")).toBe("private");
    expect(scope("172.16.5.4")).toBe("private");
    // The cloud metadata address every SSRF write-up starts with.
    expect(scope("169.254.169.254")).toBe("link-local");
    expect(scope("100.64.0.1")).toBe("carrier-grade-nat");
    expect(scope("203.0.113.9")).toBe("documentation");
    expect(scope("::1")).toBe("loopback");
    expect(scope("fe80::1")).toBe("link-local");
    expect(scope("fd00::1")).toBe("unique-local");
    expect(scope("2001:db8::1")).toBe("documentation");
    expect(scope("::ffff:10.0.0.1")).toBe("private");
    expect(scope("2606:4700::1111")).toBe("public");
  });

  it("builds reverse-DNS names", () => {
    expect(reverseName(parseIp("8.8.4.4")!)).toBe("4.4.8.8.in-addr.arpa");
    expect(reverseName(parseIp("::1")!)).toMatch(/^1\.0\.0\.0(\.0)*\.ip6\.arpa$/);
  });
});

// ---- geolocation -------------------------------------------------------------------------------

describe("geolocation", () => {
  it("places known addresses from the bundled registry tables, with no network", () => {
    expect(geolocate("8.8.8.8").country?.cc).toBe("US");
    expect(geolocate("8.8.8.8").accuracy).toBe("country");
    expect(geolocate("8.8.8.8").source).toBe("rir-delegations");
    // A European allocation, to prove the table is not simply answering "US".
    expect(geolocate("212.58.244.20").country?.cc).toBe("GB");
    expect(geolocate("2606:4700:4700::1111").country?.cc).toBe("US");
  });

  it("refuses to invent a location for an address that has none", () => {
    const local = geolocate("192.168.0.5");
    expect(local.country).toBeNull();
    expect(local.accuracy).toBe("none");
    expect(local.note).toContain("private network address");
  });

  it("reads a MaxMind database when one is configured", () => {
    process.env.GEOIP_MMDB = "apps/api/src/network/fixtures/GeoIP2-City-Test.mmdb";
    resetMmdbCache();
    expect(mmdbStatus()).toMatchObject({ configured: true, usable: true, type: "GeoIP2-City" });
    expect(lookupCity(parseIp("81.2.69.160")!)).toMatchObject({
      countryCode: "GB",
      city: "London",
      region: "England",
    });
    const geo = geolocate("2.125.160.216");
    expect(geo.source).toBe("local-mmdb");
    expect(geo.accuracy).toBe("city");
    expect(geo.city).toBe("Boxford");
  });

  it("falls back to the bundled tables when GEOIP_MMDB points at nonsense", () => {
    process.env.GEOIP_MMDB = "apps/api/src/network/fixtures/does-not-exist.mmdb";
    resetMmdbCache();
    expect(mmdbStatus().usable).toBe(false);
    expect(geolocate("8.8.8.8").source).toBe("rir-delegations");
  });

  it("reads the coordinate forms people actually paste", () => {
    expect(parseCoordinates("48.8584, 2.2945")).toEqual({ latitude: 48.8584, longitude: 2.2945 });
    expect(parseCoordinates("48.8584 2.2945")).toEqual({ latitude: 48.8584, longitude: 2.2945 });
    expect(parseCoordinates("-33.8688, 151.2093")).toEqual({
      latitude: -33.8688,
      longitude: 151.2093,
    });
    expect(parseCoordinates("N 48.8584, W 2.2945")).toEqual({
      latitude: 48.8584,
      longitude: -2.2945,
    });
    const dms = parseCoordinates("48°51'29.6\"N 2°17'40.2\"E")!;
    expect(dms.latitude).toBeCloseTo(48.8582, 3);
    expect(dms.longitude).toBeCloseTo(2.2945, 3);
    expect(parseCoordinates("91, 0")).toBeNull();
    expect(parseCoordinates("nowhere")).toBeNull();
  });
});

// ---- SSRF --------------------------------------------------------------------------------------

describe("outbound request safety", () => {
  it("allows only http and https, with no credentials and no odd ports", async () => {
    expect(() => parseSafeUrl("file:///etc/passwd")).toThrow(/http/);
    expect(() => parseSafeUrl("gopher://example.com")).toThrow(/http/);
    expect(() => parseSafeUrl("https://user:pass@example.com")).toThrow(/username and password/);
    expect(() => parseSafeUrl("http://example.com:5432/")).toThrow(/port/);
    expect(parseSafeUrl("https://example.com/x").hostname).toBe("example.com");
  });

  it("refuses a host that resolves to a private address", async () => {
    await expect(checkUrl("http://internal.test/")).rejects.toThrow(/private or local network/);
    await expect(checkUrl("http://127.0.0.1/")).rejects.toThrow(/private or local network/);
    await expect(checkUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      /private or local network/,
    );
    await expect(checkUrl("http://[::1]/")).rejects.toThrow(/private or local network/);
  });

  it("re-checks every redirect hop, so an allowed page cannot redirect inward", async () => {
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      if (String(input) === "https://example.com/") {
        return new Response("", { status: 302, headers: { location: "http://127.0.0.1/admin" } });
      }
      return new Response("should never be reached");
    }) as unknown as typeof fetch;
    await expect(safeFetch("https://example.com/", { fetchImpl })).rejects.toThrow(
      /private or local network/,
    );
  });

  it("caps the response size", async () => {
    const fetchImpl = fakeFetch({ "https://example.com/": { body: "x".repeat(5000) } });
    const response = await safeFetch("https://example.com/", { fetchImpl, maxBytes: 1000 });
    expect(response.body.length).toBe(1000);
    expect(response.truncated).toBe(true);
  });

  it("stops a redirect loop", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("", { status: 302, headers: { location: "https://example.com/" } }),
    ) as unknown as typeof fetch;
    await expect(safeFetch("https://example.com/", { fetchImpl })).rejects.toThrow(
      /redirects too many times/,
    );
  });
});

// ---- WHOIS -------------------------------------------------------------------------------------

describe("WHOIS", () => {
  it("finds the referral a registry points at", () => {
    expect(referralFrom("refer:        whois.verisign-grs.com\n")).toBe("whois.verisign-grs.com");
    expect(referralFrom("Registrar WHOIS Server: whois.example-registrar.com")).toBe(
      "whois.example-registrar.com",
    );
    expect(referralFrom("ReferralServer:  rwhois://rwhois.example.net:4321")).toBe(
      "rwhois.example.net",
    );
    expect(referralFrom("nothing to see here")).toBeNull();
  });

  it("pulls the fields people want out of the free text", () => {
    const fields = parseWhois(
      [
        "Domain Name: EXAMPLE.COM",
        "Registrar: RESERVED-Internet Assigned Numbers Authority",
        "Creation Date: 1995-08-14T04:00:00Z",
        "Registry Expiry Date: 2026-08-13T04:00:00Z",
        "Domain Status: clientDeleteProhibited",
        "Domain Status: clientTransferProhibited",
        "Name Server: A.IANA-SERVERS.NET",
        "Name Server: B.IANA-SERVERS.NET",
        "DNSSEC: signedDelegation",
      ].join("\n"),
    );
    expect(fields.domain).toBe("EXAMPLE.COM");
    expect(fields.registrar).toContain("Internet Assigned Numbers Authority");
    expect(fields.expires).toBe("2026-08-13T04:00:00Z");
    expect(fields.status).toHaveLength(2);
    expect(fields.nameServers).toEqual(["A.IANA-SERVERS.NET", "B.IANA-SERVERS.NET"]);
  });

  it("follows one referral and reports the more specific answer", async () => {
    const asked: string[] = [];
    setWhoisTransport(async (server, query) => {
      asked.push(`${server}:${query}`);
      if (server === "whois.iana.org") return "refer: whois.verisign-grs.com\n";
      return "Domain Name: EXAMPLE.COM\nRegistrar: Test Registrar\n";
    });
    const result = ok(await run("whois-lookup", "example.com"));
    // IANA is asked for the TLD (that is the record carrying the referral), the registry for the
    // domain itself.
    expect(asked).toEqual(["whois.iana.org:com", "whois.verisign-grs.com:example.com"]);
    expect(result.summary).toContain("Test Registrar");
  });

  it("says so when a registry publishes no WHOIS server at all", async () => {
    // Nominet's .uk is the real case: IANA holds the TLD record but it names no server to ask.
    setWhoisTransport(async () => `domain:       UK\nwhois:        \n`);
    const result = failure(await run("whois-lookup", "bbc.co.uk"));
    expect(result.code).toBe("UNSUPPORTED_INPUT");
    expect(result.message).toMatch(/does not publish WHOIS records/);
  });

  it("says so plainly when a domain is not registered", async () => {
    setWhoisTransport(async (server, query) =>
      server === "whois.iana.org"
        ? "refer: whois.verisign-grs.com\n"
        : `No match for ${query.toUpperCase()}`,
    );
    const result = failure(await run("whois-lookup", "nothinghere.com"));
    expect(result.code).toBe("UNSUPPORTED_INPUT");
    expect(result.message).toMatch(/not registered/);
  });
});

// ---- the tools ---------------------------------------------------------------------------------

describe("the network tools", () => {
  it("looks up a known IP address", async () => {
    setWhoisTransport(
      async () => "NetRange: 8.8.8.0 - 8.8.8.255\nOrgName: Google LLC\nCountry: US\n",
    );
    const result = ok(await run("ip-address-lookup", "8.8.8.8"));
    const output = result.output as Record<string, unknown>;
    expect(output.ip).toBe("8.8.8.8");
    expect(output.countryCode).toBe("US");
    expect(output.hostnames).toEqual(["dns.google"]);
    expect((output.registry as Record<string, unknown>).organisation).toBe("Google LLC");
    expect(result.files?.map((f) => f.name)).toEqual(["8.8.8.8-lookup.txt", "8.8.8.8-lookup.json"]);
  });

  it("rejects something that is not an address", async () => {
    const result = failure(await run("ip-address-lookup", "not-an-ip"));
    expect(result.code).toBe("UNSUPPORTED_INPUT");
    expect(result.message).toContain("8.8.8.8");
  });

  it("geolocates without any network call at all", async () => {
    const result = ok(await run("ip-geolocation", "8.8.8.8"));
    expect((result.output as { country: { cc: string } }).country.cc).toBe("US");
    expect(result.summary).toContain("United States");
  });

  it("reports the address a request arrived from", async () => {
    const result = ok(await run("public-ip-detector", null, {}, ctx("203.0.113.9, 70.41.3.18")));
    // 203.0.113.9 is documentation space, so the tool must not claim it as a public address.
    expect((result.output as Record<string, unknown>).source).toBe("echo-service");
  });

  it("asks a free echo service when it only sees a private address", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        "https://api.ipify.org/?format=json": {
          body: JSON.stringify({ ip: "93.184.216.34" }),
          headers: { "content-type": "application/json" },
        },
      }),
    );
    const result = ok(await run("public-ip-detector", null, {}, ctx("192.168.1.20")));
    const output = result.output as Record<string, unknown>;
    expect(output.ip).toBe("93.184.216.34");
    expect(output.seenByOneStop).toBe("192.168.1.20");
  });

  it("looks up DNS records for a known domain", async () => {
    const result = ok(await run("dns-lookup", "example.com"));
    const records = (result.output as { records: Record<string, string[]> }).records;
    expect(records.A).toEqual(["93.184.216.34"]);
    expect(records.NS).toEqual(["a.iana-servers.net", "b.iana-servers.net"]);
    expect(records.TXT).toEqual(["v=spf1 -all"]);
    expect(result.summary).toMatch(/example\.com has \d+ records/);
  });

  it("looks up one record type when asked", async () => {
    ok(await run("dns-lookup", "example.com", { records: "one", recordType: "MX" }));
    expect(resolveMock.mock.calls.map(([, type]) => type)).toEqual(["MX"]);
  });

  it("says a domain does not exist rather than failing obscurely", async () => {
    const result = failure(await run("dns-lookup", "no-such-domain.example"));
    expect(result.code).toBe("UNSUPPORTED_INPUT");
  });

  it("accepts a URL or an email address where a domain is wanted", () => {
    expect(normalizeHost("https://www.example.com/path?x=1")).toBe("www.example.com");
    expect(normalizeHost("someone@example.com")).toBe("example.com");
    expect(normalizeHost("EXAMPLE.COM.")).toBe("example.com");
    expect(() => normalizeHost("localhost")).toThrow(/not a domain name/);
  });

  it("parses any user-agent string, and needs nothing from the network", async () => {
    const result = ok(
      await run(
        "user-agent-lookup",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    );
    const output = result.output as {
      browser: { name: string };
      os: { name: string };
      device: { type: string };
    };
    expect(output.browser.name).toBe("Safari");
    expect(output.os.name).toBe("iOS");
    expect(output.device.type).toBe("mobile");
  });

  it("reads a website's headers, title and redirect chain", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        "https://example.com/": {
          status: 301,
          headers: { location: "https://example.com/home" },
        },
        "https://example.com/home": {
          headers: {
            "content-type": "text/html; charset=utf-8",
            server: "ExampleServer/1.0",
            "x-frame-options": "DENY",
          },
          body: '<html lang="en"><head><title>Example Domain</title><meta name="description" content="An example."><meta property="og:image" content="/card.png"></head><body></body></html>',
        },
      }),
    );
    const info = await lookupSite("https://example.com/", { certificate: false });
    expect(info.finalUrl).toBe("https://example.com/home");
    expect(info.title).toBe("Example Domain");
    expect(info.description).toBe("An example.");
    expect(info.language).toBe("en");
    expect(info.server).toBe("ExampleServer/1.0");
    expect(info.redirects).toHaveLength(1);
    expect(info.securityHeaders["x-frame-options"]).toBe("DENY");
    expect(info.securityHeaders["content-security-policy"]).toBeNull();
    expect(info.openGraph["og:image"]).toBe("/card.png");
  });

  it("reads page metadata without an HTML parser", () => {
    const meta = readPageMeta(
      "<html><head><title>  Spaced   Title </title><link rel='canonical' href='/here'></head></html>",
      "https://example.com/there",
    );
    expect(meta.title).toBe("Spaced Title");
    expect(meta.canonical).toBe("https://example.com/here");
    expect(meta.favicon).toBe("https://example.com/favicon.ico");
  });

  it("refuses a website lookup that points at the server's own network", async () => {
    const result = failure(await run("website-information-lookup", "http://internal.test/admin"));
    expect(result.code).toBe("UNSUPPORTED_INPUT");
    expect(result.message).toMatch(/private or local network/);
  });

  it("finds a place and turns coordinates back into one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(String(input));
        const body = url.pathname.endsWith("/search")
          ? JSON.stringify([
              {
                display_name: "Eiffel Tower, Paris, France",
                lat: "48.8584",
                lon: "2.2945",
                type: "attraction",
                address: { country_code: "fr", city: "Paris" },
                boundingbox: ["48.8", "48.9", "2.2", "2.3"],
              },
            ])
          : JSON.stringify({
              display_name: "Eiffel Tower, Paris, France",
              lat: "48.8584",
              lon: "2.2945",
              address: { country_code: "fr", city: "Paris" },
            });
        return new Response(body, { headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch,
    );
    const found = ok(await run("location-lookup", "Eiffel Tower"));
    expect(found.summary).toContain("48.85840");
    const reversed = ok(await run("coordinates-lookup", "48.8584, 2.2945"));
    expect(reversed.summary).toContain("Eiffel Tower");
  });

  it("rate-limits a caller that hammers one tool", async () => {
    for (let i = 0; i < 20; i++)
      ok(await run("ip-geolocation", "8.8.8.8", {}, ctx("198.51.100.7")));
    const blocked = failure(await run("ip-geolocation", "8.8.8.8", {}, ctx("198.51.100.7")));
    expect(blocked.message).toMatch(/Too many requests/);
    // A different caller is unaffected.
    ok(await run("ip-geolocation", "8.8.8.8", {}, ctx("198.51.100.8")));
  });
});

// ---- isolation ---------------------------------------------------------------------------------

describe("failure isolation", () => {
  it("turns a total loss of connectivity into the standard message, for every tool that needs it", async () => {
    const dead = () => {
      throw Object.assign(new TypeError("fetch failed"), { code: "ENOTFOUND" });
    };
    vi.stubGlobal("fetch", dead as unknown as typeof fetch);
    lookupMock.mockRejectedValue(Object.assign(new Error("offline"), { code: "EAI_AGAIN" }));
    resolveMock.mockRejectedValue(Object.assign(new Error("offline"), { code: "ECONNREFUSED" }));
    setWhoisTransport(async () => {
      throw Object.assign(new Error("offline"), { code: "ENETUNREACH" });
    });

    const cases: [string, string | null][] = [
      ["dns-lookup", "example.com"],
      ["whois-lookup", "example.com"],
      ["website-information-lookup", "https://example.com"],
      ["location-lookup", "Paris"],
      ["coordinates-lookup", "48.8584, 2.2945"],
    ];
    for (const [id, input] of cases) {
      const result = failure(await run(id, input));
      expect(result.code, `${id} should report OFFLINE`).toBe("OFFLINE");
      expect(result.message).toBe("This tool needs an Internet connection. Connect and try again.");
    }
  });

  it("keeps the offline-capable tools working while the network is down", async () => {
    vi.stubGlobal("fetch", (() => {
      throw new Error("network access attempted");
    }) as unknown as typeof fetch);
    lookupMock.mockRejectedValue(Object.assign(new Error("offline"), { code: "EAI_AGAIN" }));
    resolveMock.mockRejectedValue(Object.assign(new Error("offline"), { code: "ECONNREFUSED" }));

    // The two that are genuinely local keep answering...
    ok(await run("ip-geolocation", "8.8.8.8"));
    ok(await run("user-agent-lookup", "curl/8.4.0"));
    recordOfflineCoverage("network", ["ip-geolocation", "user-agent-lookup"]);
    // ...and a tool from an earlier phase is untouched by any of this.
    const { DEV_UTIL_EXECUTORS } = await import("../dev-utils/index.ts");
    const hash = DEV_UTIL_EXECUTORS.find(([id]) => id === "hash-generator")![1];
    expect((await hash("hello", { algorithm: "sha256" }, ctx())).ok).toBe(true);
  });

  it("does not let one tool's failure reach another", async () => {
    setWhoisTransport(async () => {
      throw new Error("the registry exploded");
    });
    // The WHOIS step inside IP Address Lookup is best-effort: the rest of the answer survives it.
    const result = ok(await run("ip-address-lookup", "8.8.8.8"));
    expect((result.output as Record<string, unknown>).registry).toBeNull();
    expect((result.output as Record<string, unknown>).countryCode).toBe("US");
    // And the tool that owns WHOIS reports it as a failure rather than throwing.
    const whoisResult = failure(await run("whois-lookup", "example.com"));
    expect(whoisResult.ok).toBe(false);
    expect(whoisResult.message).not.toContain("exploded");
  });

  it("never returns a stack trace or an internal detail to the user", async () => {
    setWhoisTransport(async () => {
      throw new Error("at Object.<anonymous> (/srv/onestop/apps/api/src/network/whois.ts:1:1)");
    });
    const result = failure(await run("whois-lookup", "example.com"));
    expect(result.message).not.toMatch(/\.ts:|at Object|\/srv\//);
  });
});
