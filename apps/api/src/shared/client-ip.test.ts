import { afterEach, describe, expect, it } from "vitest";
import {
  clearLoginFailures,
  loginBlockedFor,
  mailRequestVerdict,
  recordLoginFailure,
} from "../auth/throttle.ts";
import { clearRate, peekRate, recordHit, resetRateLimits } from "./rate-limit.ts";
import { clientIpOf, reportedClientIpOf, trustedProxyHops } from "./client-ip.ts";

const headers = (value: Record<string, string>) => ({
  get: (name: string) => value[name.toLowerCase()] ?? null,
});

afterEach(() => resetRateLimits());

describe("clientIpOf", () => {
  it("reads the address the trusted proxy appended, not the one the client chose", () => {
    const h = headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" });
    expect(clientIpOf(h, 1)).toBe("203.0.113.7");
    expect(reportedClientIpOf(h)).toBe("6.6.6.6");
  });

  it("goes further left when more proxies sit in front (a CDN plus the host)", () => {
    const h = headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.4, 203.0.113.7" });
    expect(clientIpOf(h, 2)).toBe("198.51.100.4");
    expect(clientIpOf(h, 3)).toBe("6.6.6.6");
    expect(clientIpOf(h, 9)).toBe("6.6.6.6");
  });

  it("trusts no forwarding header at all when told there is no proxy", () => {
    expect(clientIpOf(headers({ "x-forwarded-for": "6.6.6.6" }), 0)).toBeNull();
  });

  it("falls back to x-real-ip, and to nothing", () => {
    expect(clientIpOf(headers({ "x-real-ip": "203.0.113.9" }), 1)).toBe("203.0.113.9");
    expect(clientIpOf(headers({}), 1)).toBeNull();
  });

  it("never turns arbitrary header text into a limiter key", () => {
    expect(clientIpOf(headers({ "x-forwarded-for": "x".repeat(5000) }), 1)).toBeNull();
    expect(clientIpOf(headers({ "x-forwarded-for": "<script>" }), 1)).toBeNull();
    expect(clientIpOf(headers({ "x-forwarded-for": "2001:db8::1" }), 1)).toBe("2001:db8::1");
  });

  it("reads TRUSTED_PROXY_HOPS, defaulting to one and ignoring nonsense", () => {
    expect(trustedProxyHops({})).toBe(1);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "2" })).toBe(2);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "0" })).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "-1" })).toBe(1);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "many" })).toBe(1);
  });
});

describe("peekRate / recordHit / clearRate", () => {
  const limit = { limit: 2, windowMs: 60_000 };
  it("only counts what is recorded, and clears on demand", () => {
    expect(peekRate("k", limit)).toBeNull();
    expect(peekRate("k", limit)).toBeNull(); // peeking never records
    recordHit("k", limit);
    expect(peekRate("k", limit)).toBeNull();
    recordHit("k", limit);
    expect(peekRate("k", limit)).toBeGreaterThan(0);
    clearRate("k");
    expect(peekRate("k", limit)).toBeNull();
  });
});

describe("sign-in throttle", () => {
  it("pauses an address after ten wrong passwords, and a correct sign-in clears it", () => {
    for (let i = 0; i < 9; i += 1) recordLoginFailure("Victim@Example.com", `198.51.100.${i}`);
    expect(loginBlockedFor("victim@example.com", "198.51.100.99")).toBeNull();
    recordLoginFailure("victim@example.com", "198.51.100.10");
    expect(loginBlockedFor("VICTIM@example.com", "198.51.100.99")).toBeGreaterThan(0);
    clearLoginFailures("victim@example.com");
    expect(loginBlockedFor("victim@example.com", "198.51.100.99")).toBeNull();
  });

  it("pauses a caller who sprays wrong passwords across many addresses", () => {
    for (let i = 0; i < 40; i += 1) recordLoginFailure(`user${i}@example.com`, "203.0.113.50");
    expect(loginBlockedFor("someone.else@example.com", "203.0.113.50")).toBeGreaterThan(0);
    expect(loginBlockedFor("someone.else@example.com", "203.0.113.51")).toBeNull();
  });
});

describe("email throttle", () => {
  it("answers a repeat within a minute with a quiet cooldown, and caps a caller per hour", () => {
    expect(mailRequestVerdict("reset", "a@example.com", "203.0.113.1").verdict).toBe("ok");
    expect(mailRequestVerdict("reset", "A@example.com", "203.0.113.1").verdict).toBe("cooldown");
    const seen = new Set<string>();
    for (let i = 0; i < 12; i += 1) {
      seen.add(mailRequestVerdict("reset", `n${i}@example.com`, "203.0.113.2").verdict);
    }
    expect(seen.has("blocked")).toBe(true);
  });
});
