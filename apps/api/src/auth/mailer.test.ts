import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canDeliverMail,
  mailFromAddress,
  mailTransports,
  parseMailbox,
  resetEmail,
  selectedTransport,
  sendMail,
  signupCodeEmail,
} from "./mailer.ts";

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

describe("more mail providers", () => {
  it("tries every configured provider in order, and knows when only the console is left", () => {
    expect(
      mailTransports({ RESEND_API_KEY: "r", BREVO_API_KEY: "b", SMTP_URL: "smtp://x" }),
    ).toEqual(["resend", "brevo", "smtp"]);
    expect(mailTransports({ BREVO_API_KEY: "b" })).toEqual(["brevo"]);
    expect(mailTransports({})).toEqual(["console"]);
  });

  it("cannot deliver from a production server that only has the console", () => {
    expect(canDeliverMail({ NODE_ENV: "production" })).toBe(false);
    expect(canDeliverMail({ NODE_ENV: "production", BREVO_API_KEY: "b" })).toBe(true);
    // A developer at a terminal can read the console, so it counts outside production.
    expect(canDeliverMail({ NODE_ENV: "development" })).toBe(true);
  });

  it("uses the SMTP account as the sender when no from address is set", () => {
    const env = { SMTP_URL: "smtp://me%40gmail.com:app-password@smtp.gmail.com:587" };
    expect(mailFromAddress(env)).toBe("OneStop <me@gmail.com>");
    expect(mailFromAddress({ ...env, MAIL_FROM: "Me <me@example.com>" })).toBe(
      "Me <me@example.com>",
    );
  });

  it("splits a mailbox into name and address", () => {
    expect(parseMailbox("OneStop <hi@example.com>")).toEqual({
      name: "OneStop",
      email: "hi@example.com",
    });
    expect(parseMailbox("hi@example.com")).toEqual({ email: "hi@example.com" });
  });

  it("sends through Brevo over HTTPS with the api-key header", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendMail(
      { to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" },
      { BREVO_API_KEY: "xkeysib-1", MAIL_FROM: "OneStop <me@example.com>" },
    );
    expect(result).toEqual({ transport: "brevo", delivered: true });
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const [url, init] = calls[0]!;
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-1");
    expect(JSON.parse(String(init.body))).toMatchObject({
      sender: { email: "me@example.com", name: "OneStop" },
      to: [{ email: "a@example.com" }],
    });
    vi.unstubAllGlobals();
  });

  it("falls through to the next provider when the first one fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("resend")
        ? new Response("no", { status: 500 })
        : new Response("{}", { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendMail(
      { to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" },
      { RESEND_API_KEY: "re_x", BREVO_API_KEY: "b", MAIL_FROM: "OneStop <me@example.com>" },
    );
    expect(result).toMatchObject({ transport: "brevo", delivered: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});

describe("sign-up code email", () => {
  it("shows the code big, in the subject, and says how long it lasts", () => {
    const mail = signupCodeEmail("048213", new Date(Date.now() + 10 * 60_000));
    expect(mail.subject).toContain("048213");
    expect(mail.text).toContain("Your verification code is: 048213");
    expect(mail.text).toMatch(/10 minutes/);
    expect(mail.html).toContain("048213");
  });
});
