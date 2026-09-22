// Sending the account emails: password-reset links and sign-up codes (13-auth-database.md).
//
// Four paths, chosen by environment - every one has a free tier:
//   console  (default) writes the message to the server console. Nothing to sign up for; this is the
//            local/offline path. It is *not* a delivery: a hosted server that only has this cannot
//            reach anybody (see `canDeliverMail`).
//   resend   posts to the Resend API with RESEND_API_KEY, plain fetch (HTTPS, so it works on hosts
//            that block SMTP ports - Render's free tier does).
//   brevo    posts to the Brevo API with BREVO_API_KEY (free, 300/day, any verified sender), plain fetch.
//   smtp     uses SMTP_URL through nodemailer (Gmail with an app password works, for example).
//
// When several are configured they are tried in that order, so a provider that is down, out of
// quota or blocked never costs the user their email while another one would have worked. Whatever
// happens, callers decide what to tell the user: the reset flow answers neutrally either way.
export type MailTransport = "console" | "resend" | "brevo" | "smtp";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailResult {
  transport: MailTransport;
  delivered: boolean;
  /** Populated when the transport is `console`, so dev tooling can surface the link. */
  preview?: string;
  error?: string;
}

const REAL_TRANSPORTS: MailTransport[] = ["resend", "brevo", "smtp"];

function configured(transport: MailTransport, env: NodeJS.ProcessEnv): boolean {
  switch (transport) {
    case "resend":
      return Boolean(env.RESEND_API_KEY?.trim());
    case "brevo":
      return Boolean(env.BREVO_API_KEY?.trim());
    case "smtp":
      return Boolean(env.SMTP_URL?.trim());
    case "console":
      return true;
  }
}

/** Every transport that would be tried, in order. Always ends up non-empty (console at worst). */
export function mailTransports(env: NodeJS.ProcessEnv = process.env): MailTransport[] {
  const explicit = env.MAIL_TRANSPORT?.trim().toLowerCase();
  if (explicit === "console") return ["console"];
  if (explicit === "resend" || explicit === "brevo" || explicit === "smtp") return [explicit];
  const found = REAL_TRANSPORTS.filter((t) => configured(t, env));
  return found.length > 0 ? found : ["console"];
}

/** The first transport that would be tried. */
export function selectedTransport(env: NodeJS.ProcessEnv = process.env): MailTransport {
  return mailTransports(env)[0]!;
}

/**
 * Whether an email sent now can actually reach a person. The console transport is a fine stand-in
 * for a developer at a terminal, but on a production server it silently delivers to nobody - so
 * flows that *need* the email (sign-up codes) refuse up front instead of pretending.
 */
export function canDeliverMail(env: NodeJS.ProcessEnv = process.env): boolean {
  if (mailTransports(env).some((t) => t !== "console")) return true;
  return env.NODE_ENV !== "production";
}

export const MAIL_NOT_CONFIGURED_MESSAGE =
  "Email delivery is not set up on this server yet, so we can't send you a message. Ask the site owner to configure it.";

/** The address inside `Name <address>`, or the whole value when there is no name part. */
export function parseMailbox(value: string): { name?: string; email: string } {
  const match = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(value);
  if (match) {
    const name = match[1]?.trim();
    return { ...(name ? { name } : {}), email: match[2]!.trim() };
  }
  return { email: value.trim() };
}

/** The user name of an `smtp://user:pass@host` URL, when it is itself an email address. */
function smtpUser(env: NodeJS.ProcessEnv): string | null {
  try {
    const url = new URL(env.SMTP_URL?.trim() ?? "");
    const user = decodeURIComponent(url.username);
    return /^[^\s@]+@[^\s@]+$/.test(user) ? user : null;
  } catch {
    return null;
  }
}

export function mailFromAddress(
  env: NodeJS.ProcessEnv = process.env,
  transport: MailTransport = selectedTransport(env),
): string {
  const explicit = env.MAIL_FROM?.trim();
  if (explicit) return explicit;
  // Gmail and most SMTP relays only accept their own account as the sender.
  if (transport === "smtp") {
    const user = smtpUser(env);
    if (user) return `OneStop <${user}>`;
  }
  return "OneStop <onboarding@resend.dev>";
}

const MAIL_STYLE =
  "font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.5";

export function resetEmail(
  link: string,
  expiresAt: Date,
): { subject: string; text: string; html: string } {
  const minutes = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));
  const subject = "Reset your OneStop password";
  const text = [
    "Someone asked to reset the password for this OneStop account.",
    "",
    `Open this link to choose a new one (it expires in ${minutes} minutes):`,
    link,
    "",
    "If that wasn't you, you can ignore this email - nothing has changed.",
  ].join("\n");
  const html = [
    `<div style="${MAIL_STYLE}">`,
    `<p>Someone asked to reset the password for this OneStop account.</p>`,
    `<p><a href="${escapeHtml(link)}">Choose a new password</a> (the link expires in ${minutes} minutes).</p>`,
    `<p style="color:#666">If that wasn't you, you can ignore this email - nothing has changed.</p>`,
    `</div>`,
  ].join("\n");
  return { subject, text, html };
}

/** The sign-up verification email: a short numeric code the person types back into the app. */
export function signupCodeEmail(
  code: string,
  expiresAt: Date,
): { subject: string; text: string; html: string } {
  const minutes = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));
  const subject = `${code} is your OneStop verification code`;
  const text = [
    "Welcome to OneStop!",
    "",
    `Your verification code is: ${code}`,
    "",
    `Type it into the sign-up page to finish creating your account (it expires in ${minutes} minutes).`,
    "",
    "If you didn't try to sign up, you can ignore this email - no account has been created.",
  ].join("\n");
  const html = [
    `<div style="${MAIL_STYLE}">`,
    `<p>Welcome to OneStop!</p>`,
    `<p>Your verification code is:</p>`,
    `<p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:8px 0">${escapeHtml(code)}</p>`,
    `<p>Type it into the sign-up page to finish creating your account (it expires in ${minutes} minutes).</p>`,
    `<p style="color:#666">If you didn't try to sign up, you can ignore this email - no account has been created.</p>`,
    `</div>`,
  ].join("\n");
  return { subject, text, html };
}

/** A short numeric code, presented the same way for every "prove you can read this mailbox" email. */
function codeEmail(
  intro: string,
  code: string,
  expiresAt: Date,
  subjectSuffix: string,
  footer: string,
): { subject: string; text: string; html: string } {
  const minutes = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));
  const subject = `${code} is your OneStop ${subjectSuffix} code`;
  const text = [
    intro,
    "",
    `Your verification code is: ${code}`,
    "",
    `Type it into OneStop to continue (it expires in ${minutes} minutes).`,
    "",
    footer,
  ].join("\n");
  const html = [
    `<div style="${MAIL_STYLE}">`,
    `<p>${escapeHtml(intro)}</p>`,
    `<p>Your verification code is:</p>`,
    `<p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:8px 0">${escapeHtml(code)}</p>`,
    `<p>Type it into OneStop to continue (it expires in ${minutes} minutes).</p>`,
    `<p style="color:#666">${escapeHtml(footer)}</p>`,
    `</div>`,
  ].join("\n");
  return { subject, text, html };
}

/** Sent to the *current* address of an account asking to change its email. */
export function emailChangeCurrentEmail(
  code: string,
  expiresAt: Date,
): { subject: string; text: string; html: string } {
  return codeEmail(
    "Someone asked to change the email address on this OneStop account.",
    code,
    expiresAt,
    "email change",
    "If that wasn't you, you can ignore this email - nothing has changed yet, and no code was sent to any new address.",
  );
}

/** Sent to the *new* address, once the current one has been confirmed. */
export function emailChangeNewEmail(
  code: string,
  expiresAt: Date,
): { subject: string; text: string; html: string } {
  return codeEmail(
    "Confirm this address to finish moving a OneStop account to it.",
    code,
    expiresAt,
    "email change",
    "If you didn't expect this, you can ignore it - your email address will not be changed to this one.",
  );
}

/** Sent to confirm an account deletion. */
export function accountDeleteEmail(
  code: string,
  expiresAt: Date,
): { subject: string; text: string; html: string } {
  return codeEmail(
    "Someone asked to permanently delete this OneStop account.",
    code,
    expiresAt,
    "account deletion",
    "If that wasn't you, you can ignore this email - your account has not been deleted.",
  );
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

export async function sendMail(
  mail: Mail,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MailResult> {
  const transports = mailTransports(env);
  let last: MailResult | null = null;
  for (const transport of transports) {
    if (transport === "console") continue;
    try {
      if (transport === "resend") return await sendWithResend(mail, env);
      if (transport === "brevo") return await sendWithBrevo(mail, env);
      return await sendWithSmtp(mail, env);
    } catch (err) {
      console.error(`[mail] ${transport} delivery failed.`, err);
      last = {
        transport,
        delivered: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  // Nothing real is configured (or everything configured failed): keep the message where a
  // developer can find it. A dev with no provider counts this as delivered; a failure does not.
  logToConsole(mail);
  return last ?? { transport: "console", delivered: true, preview: mail.text };
}

function logToConsole(mail: Mail): void {
  // `warn` rather than `info`: the project's lint rules allow warn/error only, and a mail that
  // was never actually delivered is genuinely worth standing out in the log.
  console.warn(
    [
      "",
      "──────────────── OneStop mail (console transport) ────────────────",
      `To:      ${mail.to}`,
      `Subject: ${mail.subject}`,
      "",
      mail.text,
      "──────────────────────────────────────────────────────────────────",
      "",
    ].join("\n"),
  );
}

async function sendWithResend(mail: Mail, env: NodeJS.ProcessEnv): Promise<MailResult> {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) throw new Error("RESEND_API_KEY is not set.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: mailFromAddress(env, "resend"),
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Resend replied ${response.status}.`);
  return { transport: "resend", delivered: true };
}

async function sendWithBrevo(mail: Mail, env: NodeJS.ProcessEnv): Promise<MailResult> {
  const key = env.BREVO_API_KEY?.trim();
  if (!key) throw new Error("BREVO_API_KEY is not set.");
  const sender = parseMailbox(mailFromAddress(env, "brevo"));
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: sender.email, ...(sender.name ? { name: sender.name } : {}) },
      to: [{ email: mail.to }],
      subject: mail.subject,
      textContent: mail.text,
      htmlContent: mail.html,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Brevo replied ${response.status}.`);
  return { transport: "brevo", delivered: true };
}

async function sendWithSmtp(mail: Mail, env: NodeJS.ProcessEnv): Promise<MailResult> {
  const url = env.SMTP_URL?.trim();
  if (!url) throw new Error("SMTP_URL is not set.");
  // The specifier is held in a variable so neither TypeScript (there are no bundled types) nor the
  // bundler tries to resolve the package at build time.
  const specifier = "nodemailer";
  const nodemailer = (await import(/* webpackIgnore: true */ specifier).catch(() => null)) as {
    createTransport: (options: Record<string, unknown>) => {
      sendMail: (m: Record<string, unknown>) => Promise<unknown>;
    };
  } | null;
  if (!nodemailer) {
    throw new Error("SMTP needs the `nodemailer` package: npm install nodemailer");
  }
  // Short timeouts: a host that blocks outbound SMTP would otherwise hang the request for minutes
  // instead of falling through to the next provider (or telling the user).
  await nodemailer
    .createTransport({
      url,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    })
    .sendMail({
      from: mailFromAddress(env, "smtp"),
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
  return { transport: "smtp", delivered: true };
}
