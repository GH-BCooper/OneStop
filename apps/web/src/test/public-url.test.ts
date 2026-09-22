// The small pure helpers behind this pass: which address goes in an emailed link, how the assistant
// routes read the visitor's AI choice, and where sign-in lands.
import { describe, expect, it } from "vitest";
import { readAiCredentials } from "@/lib/ai-request";
import { applyPublicAuthUrl, publicBaseUrl } from "@/lib/public-url";
import { landingAfterSignIn } from "@/components/auth/forms";

const RENDER = "https://onestop.onrender.com";

describe("publicBaseUrl", () => {
  it("uses the configured public address", () => {
    expect(publicBaseUrl(undefined, { APP_URL: "https://app.example.com/" })).toBe(
      "https://app.example.com",
    );
  });

  it("ignores a localhost value copied from a local .env when the platform knows the real address", () => {
    const env = { APP_URL: "http://localhost:10000", RENDER_EXTERNAL_URL: RENDER };
    expect(publicBaseUrl(undefined, env)).toBe(RENDER);
  });

  it("never trusts the request's Host header when anything is configured", () => {
    const forged = new Request("https://evil.example/api/auth/reset", {
      headers: { host: "evil.example", "x-forwarded-host": "evil.example" },
    });
    expect(publicBaseUrl(forged, { APP_URL: "https://app.example.com" })).toBe(
      "https://app.example.com",
    );
    expect(publicBaseUrl(forged, { RENDER_EXTERNAL_URL: RENDER })).toBe(RENDER);
  });

  it("falls back to a local address on a plain local run", () => {
    expect(publicBaseUrl(undefined, { APP_URL: "http://localhost:3000" })).toBe(
      "http://localhost:3000",
    );
    expect(publicBaseUrl(undefined, {})).toBe("http://localhost:3000");
  });

  it("points Auth.js at the real address only when the configured one is missing or local", () => {
    const local: Record<string, string | undefined> = {
      NEXTAUTH_URL: "http://localhost:10000",
      RENDER_EXTERNAL_URL: RENDER,
    };
    applyPublicAuthUrl(local);
    expect(local.AUTH_URL).toBe(RENDER);

    const configured: Record<string, string | undefined> = {
      AUTH_URL: "https://app.example.com",
      RENDER_EXTERNAL_URL: RENDER,
    };
    applyPublicAuthUrl(configured);
    expect(configured.AUTH_URL).toBe("https://app.example.com");

    const dev: Record<string, string | undefined> = { NEXTAUTH_URL: "http://localhost:3000" };
    applyPublicAuthUrl(dev);
    expect(dev.AUTH_URL).toBeUndefined();
  });
});

function header(value: unknown): Request {
  return new Request("http://localhost/api/assistant/plan", {
    headers: { "x-onestop-ai": Buffer.from(JSON.stringify(value)).toString("base64") },
  });
}

describe("readAiCredentials", () => {
  it("reads OneStop's own service as hosted, ignoring anything else that was sent", () => {
    expect(readAiCredentials(header({ mode: "onestop", keys: { groq: "browser" } }))).toEqual({
      mode: "hosted",
    });
  });

  it("reads the visitor's own provider and keys, dropping unknown providers and blank keys", () => {
    const credentials = readAiCredentials(
      header({
        mode: "own",
        provider: "groq",
        keys: { groq: " gsk_1 ", openrouter: "", evil: "x" },
      }),
    );
    expect(credentials).toEqual({ mode: "own", provider: "groq", keys: { groq: "gsk_1" } });
  });

  it("treats a malformed header like no header", () => {
    const request = new Request("http://localhost/x", { headers: { "x-onestop-ai": "%%%" } });
    expect(readAiCredentials(request)).toMatchObject({ provider: null, apiKey: null });
  });
});

describe("landingAfterSignIn", () => {
  it("goes home, never to the account page, another auth page or off-site", () => {
    expect(landingAfterSignIn(null)).toBe("/");
    expect(landingAfterSignIn("/account")).toBe("/");
    expect(landingAfterSignIn("/account?tab=app")).toBe("/");
    expect(landingAfterSignIn("/auth/signup")).toBe("/");
    expect(landingAfterSignIn("//evil.example")).toBe("/");
    expect(landingAfterSignIn("https://evil.example")).toBe("/");
  });

  it("still returns someone to the tool or page they were sent from", () => {
    expect(landingAfterSignIn("/tools/pdf/merge-pdf")).toBe("/tools/pdf/merge-pdf");
    expect(landingAfterSignIn("/history")).toBe("/history");
  });
});
