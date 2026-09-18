// Sending the password-reset email (13-auth-database.md).
//
// Three paths, chosen by environment - all free:
//   console  (default) writes the link to the server console. Nothing to sign up for; this is the
//            local/offline path, and the only one the app needs to work.
//   resend   posts to the Resend API with RESEND_API_KEY (free tier), no dependency: plain fetch.
//   smtp     uses SMTP_URL through nodemailer if it is installed (optional dependency).
//
// Whatever happens, the reset flow itself never fails because mail could not be sent: the caller
// answers with the same neutral message either way, and dev keeps the link on the console.
export type MailTransport = "console" | "resend" | "smtp";

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

export function selectedTransport(env: NodeJS.ProcessEnv = process.env): MailTransport {
  const explicit = env.MAIL_TRANSPORT?.trim().toLowerCase();
  if (explicit === "console" || explicit === "resend" || explicit === "smtp") return explicit;
  if (env.RESEND_API_KEY?.trim()) return "resend";
  if (env.SMTP_URL?.trim()) return "smtp";
  return "console";
}

export function mailFromAddress(env: NodeJS.ProcessEnv = process.env): string {
  return env.MAIL_FROM?.trim() || "OneStop <onboarding@resend.dev>";
}

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
    `<p>Someone asked to reset the password for this OneStop account.</p>`,
    `<p><a href="${escapeHtml(link)}">Choose a new password</a> (the link expires in ${minutes} minutes).</p>`,
    `<p style="color:#666">If that wasn't you, you can ignore this email - nothing has changed.</p>`,
  ].join("\n");
  return { subject, text, html };
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
  const transport = selectedTransport(env);
  try {
    if (transport === "resend") return await sendWithResend(mail, env);
    if (transport === "smtp") return await sendWithSmtp(mail, env);
  } catch (err) {
    console.error(`[mail] ${transport} delivery failed; falling back to the console.`, err);
    logToConsole(mail);
    return {
      transport,
      delivered: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  logToConsole(mail);
  return { transport: "console", delivered: true, preview: mail.text };
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
      from: mailFromAddress(env),
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

async function sendWithSmtp(mail: Mail, env: NodeJS.ProcessEnv): Promise<MailResult> {
  const url = env.SMTP_URL?.trim();
  if (!url) throw new Error("SMTP_URL is not set.");
  // Optional dependency: only people who choose SMTP need it installed. The specifier is held in
  // a variable so neither TypeScript nor the bundler treats a missing package as a build error.
  const specifier = "nodemailer";
  const nodemailer = (await import(/* webpackIgnore: true */ specifier).catch(() => null)) as {
    createTransport: (url: string) => {
      sendMail: (m: Record<string, unknown>) => Promise<unknown>;
    };
  } | null;
  if (!nodemailer) {
    throw new Error("SMTP needs the optional `nodemailer` package: npm install nodemailer");
  }
  await nodemailer.createTransport(url).sendMail({
    from: mailFromAddress(env),
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  return { transport: "smtp", delivered: true };
}
