import { afterEach, describe, expect, it, vi } from "vitest";
import { mailFromAddress, resetEmail, selectedTransport, sendMail } from "./mailer.ts";

afterEach(() => vi.restoreAllMocks());

describe("mail transport selection", () => {
  it("defaults to the console, which needs no account and no network", () => {
    expect(selectedTransport({})).toBe("console");
  });

  it("uses Resend or SMTP when configured, and honours an explicit override", () => {
    expect(selectedTransport({ RESEND_API_KEY: "re_x" })).toBe("resend");
    expect(selectedTransport({ SMTP_URL: "smtp://localhost:1025" })).toBe("smtp");
    expect(selectedTransport({ RESEND_API_KEY: "re_x", MAIL_TRANSPORT: "console" })).toBe(
      "console",
    );
  });

  it("has a from address without any configuration", () => {
    expect(mailFromAddress({})).toMatch(/@/);
    expect(mailFromAddress({ MAIL_FROM: "OneStop <me@example.com>" })).toBe(
      "OneStop <me@example.com>",
    );
  });
});

describe("reset email", () => {
  it("contains the link and escapes it in the HTML part", () => {
    const link = "http://localhost:3000/auth/reset-password?token=a&b";
    const mail = resetEmail(link, new Date(Date.now() + 60 * 60_000));
    expect(mail.text).toContain(link);
    expect(mail.html).toContain("token=a&amp;b");
    expect(mail.subject).toMatch(/reset/i);
    expect(mail.text).toMatch(/60 minutes/);
  });
});

describe("sendMail", () => {
  it("logs to the console and reports delivery when no provider is configured", async () => {
    const info = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await sendMail(
      { to: "a@example.com", subject: "s", text: "the link", html: "<p>the link</p>" },
      {},
    );
    expect(result).toMatchObject({ transport: "console", delivered: true });
    expect(info).toHaveBeenCalledOnce();
    expect(String(info.mock.calls[0]?.[0])).toContain("the link");
  });

  it("falls back to the console when the provider fails, and says so", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 401 })),
    );
    const result = await sendMail(
      { to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" },
      { RESEND_API_KEY: "re_bad" },
    );
    expect(result.transport).toBe("resend");
    expect(result.delivered).toBe(false);
    expect(result.error).toMatch(/401/);
    vi.unstubAllGlobals();
  });
});
