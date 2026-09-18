// QR payload formats (11-qr-tools.md).
//
// A QR code only ever holds text; what makes a "Wi-Fi QR" or a "contact QR" is the *convention*
// the text follows. This file owns both directions of every convention OneStop supports:
// building a payload from fields, and recognising one when the scanner reads it back. It is pure
// string work with no dependencies, so the round-trip tests can drive it directly and phases
// 15/16 can reuse it.
import { PdfToolError } from "../pdf/errors.ts";

export function unsupported(message: string, detail?: unknown): PdfToolError {
  return new PdfToolError("UNSUPPORTED_INPUT", message, detail);
}

/** Every payload convention the scanner can name. */
export type PayloadKind =
  "url" | "email" | "phone" | "sms" | "wifi" | "contact" | "geo" | "event" | "text";

export interface ParsedPayload {
  kind: PayloadKind;
  /** One-line human description, e.g. 'Wi-Fi network "Home" (WPA)'. */
  label: string;
  /** Recognised fields, flattened for display. */
  fields: Record<string, string>;
  /** The raw text as encoded. */
  text: string;
}

// ---- helpers ----------------------------------------------------------------------------------

function required(value: string, what: string): string {
  const trimmed = value.trim();
  if (trimmed === "") throw unsupported(`Enter ${what}.`);
  return trimmed;
}

/** Strips control characters, which have no place in a scannable payload. */
export function clean(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    const isControl = code < 0x20 ? code !== 0x09 && code !== 0x0a && code !== 0x0d : code === 0x7f;
    if (!isControl) out += ch;
  }
  return out.trim();
}

/** `WIFI:` escaping: backslash, semicolon, comma, colon and quote. */
export function escapeWifi(value: string): string {
  return value.replace(/([\\;,:"])/g, "\\$1");
}

function unescapeWifi(value: string): string {
  return value.replace(/\\(.)/g, "$1");
}

/** vCard escaping (RFC 6350 3.4): backslash, comma, semicolon and newline. */
export function escapeVCard(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/([;,])/g, "\\$1")
    .replace(/\r?\n/g, "\\n");
}

function unescapeVCard(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\([\\;,])/g, "$1");
}

/** vCard lines are folded at 75 octets (RFC 6350 3.2); some readers insist on it. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(` ${line.slice(i, i + 74)}`);
  return parts.join("\r\n");
}

// ---- URL ---------------------------------------------------------------------------------------

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\/[^\s/$.?#][^\s]*$/i;

/**
 * Normalises a link for a QR code. A bare "example.com" gets https://, and anything that is not
 * plain http(s) is refused: a QR code is scanned by a phone that will *open* what it finds, so an
 * unexpected scheme is exactly the thing not to encode (master plan 15).
 */
export function buildUrl(input: string): string {
  const value = required(clean(input), "a web address");
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  if (!/^https?:\/\//i.test(withScheme)) {
    throw unsupported("Only http:// and https:// links can be made into a link QR code.");
  }
  if (!URL_RE.test(withScheme)) throw unsupported("Enter a full link, e.g. https://example.com.");
  try {
    return new URL(withScheme).toString();
  } catch {
    throw unsupported("Enter a full link, e.g. https://example.com.");
  }
}

// ---- email / phone / sms -----------------------------------------------------------------------

const EMAIL_RE = /^[^\s@,;:<>]+@[^\s@,;:<>]+\.[^\s@,;:<>]+$/;

export interface EmailFields {
  to: string;
  subject?: string;
  body?: string;
}

export function buildEmail({ to, subject, body }: EmailFields): string {
  const address = required(clean(to), "an email address");
  if (!EMAIL_RE.test(address)) {
    throw unsupported("Enter a valid email address, e.g. me@example.com.");
  }
  const query = new URLSearchParams();
  if (subject && clean(subject) !== "") query.set("subject", clean(subject));
  if (body && body.trim() !== "") query.set("body", body.trim());
  const suffix = query.toString();
  return `mailto:${address}${suffix ? `?${suffix}` : ""}`;
}

/** Keeps digits, a leading +, and the dial characters phones understand. */
export function normalisePhone(input: string): string {
  const value = clean(input).replace(/[\s()./-]/g, "");
  if (!/^\+?[0-9*#,;]{3,20}$/.test(value)) {
    throw unsupported("Enter a phone number, digits only (a leading + is fine).");
  }
  return value;
}

export function buildPhone(input: string): string {
  return `tel:${normalisePhone(input)}`;
}

export function buildSms(input: string, message = ""): string {
  const number = normalisePhone(input);
  const text = message.trim();
  return text === "" ? `sms:${number}` : `sms:${number}?body=${encodeURIComponent(text)}`;
}

// ---- Wi-Fi ---------------------------------------------------------------------------------

export type WifiSecurity = "WPA" | "WEP" | "nopass";

export interface WifiFields {
  ssid: string;
  password?: string;
  security?: WifiSecurity;
  hidden?: boolean;
}

/**
 * The `WIFI:` convention Android and iOS both implement:
 *   WIFI:T:WPA;S:<ssid>;P:<password>;H:true;;
 * Field order matters to some older readers, and the payload ends with two semicolons.
 */
export function buildWifi({
  ssid,
  password = "",
  security = "WPA",
  hidden = false,
}: WifiFields): string {
  const name = required(clean(ssid), "the network name (SSID)");
  if (security !== "nopass" && password.trim() === "") {
    throw unsupported('Enter the network password, or set the security to "Open (no password)".');
  }
  const parts = [`T:${security}`, `S:${escapeWifi(name)}`];
  if (security !== "nopass") parts.push(`P:${escapeWifi(password.trim())}`);
  if (hidden) parts.push("H:true");
  return `WIFI:${parts.join(";")};;`;
}

/** Splits a `WIFI:` body on semicolons that are not backslash-escaped. */
function wifiChunks(body: string): string[] {
  const chunks: string[] = [];
  let current = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (ch === "\\") {
      current += ch + (body[i + 1] ?? "");
      i += 1;
    } else if (ch === ";") {
      chunks.push(current);
      current = "";
    } else current += ch;
  }
  if (current !== "") chunks.push(current);
  return chunks;
}

function parseWifi(text: string): ParsedPayload | null {
  if (!/^WIFI:/i.test(text)) return null;
  const fields: Record<string, string> = {};
  for (const chunk of wifiChunks(text.slice(5))) {
    const colon = chunk.indexOf(":");
    if (colon <= 0) continue;
    const key = chunk.slice(0, colon).toUpperCase();
    const value = unescapeWifi(chunk.slice(colon + 1));
    if (key === "S") fields.ssid = value;
    else if (key === "T") fields.security = value;
    else if (key === "P") fields.password = value;
    else if (key === "H") fields.hidden = value;
  }
  if (!fields.ssid) return null;
  const security = fields.security && fields.security !== "nopass" ? fields.security : "open";
  return { kind: "wifi", label: `Wi-Fi network "${fields.ssid}" (${security})`, fields, text };
}

// ---- contact (vCard) -----------------------------------------------------------------------

export interface ContactFields {
  name: string;
  organisation?: string;
  title?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  note?: string;
}

/** Splits "Ada Lovelace" into the vCard N field's family;given;middle;;  order. */
function structuredName(name: string): string {
  const parts = name.split(/\s+/);
  if (parts.length === 1) return `${escapeVCard(parts[0]!)};;;;`;
  const family = parts[parts.length - 1]!;
  const given = parts[0]!;
  const middle = parts.slice(1, -1).join(" ");
  return `${escapeVCard(family)};${escapeVCard(given)};${escapeVCard(middle)};;`;
}

/** vCard 3.0 - the version phone contact apps accept most widely. */
export function buildVCard(fields: ContactFields): string {
  const name = required(clean(fields.name), "a name for the contact");
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${structuredName(name)}`,
    `FN:${escapeVCard(name)}`,
  ];
  const org = clean(fields.organisation ?? "");
  if (org) lines.push(`ORG:${escapeVCard(org)}`);
  const title = clean(fields.title ?? "");
  if (title) lines.push(`TITLE:${escapeVCard(title)}`);
  const phone = clean(fields.phone ?? "");
  if (phone) lines.push(`TEL;TYPE=CELL:${normalisePhone(phone)}`);
  const email = clean(fields.email ?? "");
  if (email) {
    if (!EMAIL_RE.test(email)) throw unsupported("Enter a valid email address for the contact.");
    lines.push(`EMAIL;TYPE=INTERNET:${escapeVCard(email)}`);
  }
  const website = clean(fields.website ?? "");
  if (website) lines.push(`URL:${escapeVCard(buildUrl(website))}`);
  const address = clean(fields.address ?? "");
  if (address) lines.push(`ADR;TYPE=HOME:;;${escapeVCard(address)};;;;`);
  const note = (fields.note ?? "").trim();
  if (note) lines.push(`NOTE:${escapeVCard(note)}`);
  lines.push("END:VCARD");
  return lines.map(fold).join("\r\n");
}

function parseVCard(text: string): ParsedPayload | null {
  if (!/^BEGIN:VCARD/i.test(text.trim())) return null;
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const fields: Record<string, string> = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).split(";")[0]!.toUpperCase();
    const value = unescapeVCard(line.slice(colon + 1));
    if (key === "FN") fields.name = value;
    else if (key === "ORG") fields.organisation = value;
    else if (key === "TITLE") fields.title = value;
    else if (key === "TEL") fields.phone = value;
    else if (key === "EMAIL") fields.email = value;
    else if (key === "URL") fields.website = value;
    else if (key === "ADR") fields.address = value.replace(/^;+|;+$/g, "").replace(/;/g, ", ");
    else if (key === "NOTE") fields.note = value;
  }
  const name = fields.name ?? "";
  return {
    kind: "contact",
    label: name ? `Contact card for ${name}` : "Contact card",
    fields,
    text,
  };
}

// ---- geo ---------------------------------------------------------------------------------------

export function buildGeo(lat: number, lon: number): string {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw unsupported("Latitude must be between -90 and 90.");
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw unsupported("Longitude must be between -180 and 180.");
  }
  return `geo:${lat},${lon}`;
}

// ---- recognition ------------------------------------------------------------------------------

/** Names what a decoded QR payload is, so the scanner can offer the right next step. */
export function parsePayload(raw: string): ParsedPayload {
  const text = raw;
  const trimmed = raw.trim();

  const wifi = parseWifi(trimmed);
  if (wifi) return wifi;
  const vcard = parseVCard(trimmed);
  if (vcard) return vcard;

  if (/^mailto:/i.test(trimmed)) {
    const rest = trimmed.slice(7);
    const [address, query = ""] = rest.split("?");
    const params = new URLSearchParams(query);
    const fields: Record<string, string> = { to: decodeURIComponent(address ?? "") };
    const subject = params.get("subject");
    if (subject) fields.subject = subject;
    const body = params.get("body");
    if (body) fields.body = body;
    return { kind: "email", label: `Email to ${fields.to}`, fields, text };
  }
  if (/^tel:/i.test(trimmed)) {
    const number = trimmed.slice(4);
    return { kind: "phone", label: `Phone number ${number}`, fields: { number }, text };
  }
  if (/^smsto:|^sms:/i.test(trimmed)) {
    const rest = trimmed.replace(/^smsto:|^sms:/i, "");
    const [number = "", tail = ""] = rest.split(/[?:]/);
    const message = tail.startsWith("body=") ? decodeURIComponent(tail.slice(5)) : tail;
    return {
      kind: "sms",
      label: `Text message to ${number}`,
      fields: message ? { number, message } : { number },
      text,
    };
  }
  if (/^geo:/i.test(trimmed)) {
    const [lat = "", lon = ""] = trimmed.slice(4).split(",");
    return {
      kind: "geo",
      label: `Map location ${lat}, ${lon}`,
      fields: { latitude: lat, longitude: lon },
      text,
    };
  }
  if (/^BEGIN:VEVENT/i.test(trimmed)) {
    return { kind: "event", label: "Calendar event", fields: {}, text };
  }
  if (URL_RE.test(trimmed)) {
    let host: string;
    try {
      host = new URL(trimmed).host;
    } catch {
      host = "";
    }
    return {
      kind: "url",
      label: host ? `Link to ${host}` : "Link",
      fields: { url: trimmed },
      text,
    };
  }
  const preview = trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
  return {
    kind: "text",
    label: preview === "" ? "Empty QR code" : `Text: ${preview}`,
    fields: { text: trimmed },
    text,
  };
}
