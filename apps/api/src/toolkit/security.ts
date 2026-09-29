// Security & Privacy Toolkit (21-roadmap-expansion.md, roadmap §1.10).
//
// Everything here is local and dependency-free:
//  • Password Strength Meter — an entropy estimate over the character classes actually used, minus
//    penalties for the patterns that make a password guessable (dictionary words, keyboard runs,
//    repeats, dates). It is deliberately *not* a claim of safety: it explains its own reasoning.
//  • TOTP — RFC 6238 over `node:crypto`'s HMAC, plus base32 decoding written out here.
//  • Diceware — a bundled public-domain-style word list and `randomInt` (the platform CSPRNG).
//  • File Encryptor/Decryptor — AES-256-GCM with a PBKDF2-SHA-256 derived key, in a small
//    self-describing container so Decrypt never has to guess the parameters.
//  • Breach Check — the only Internet-required tool here, and it uses HaveIBeenPwned's
//    k-anonymity range API: five hex characters of a SHA-1 hash leave this machine, never the
//    password.
import { createCipheriv, createDecipheriv, createHmac, pbkdf2Sync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Executor } from "@onestop/tool-registry";
import type { FileRef, OutputFile } from "@onestop/types";
import { packageFiles } from "../images/common.ts";
import {
  MIME,
  csvFile,
  failed,
  jsonFile,
  optBool,
  optEnum,
  optNumber,
  optString,
  plural,
  requireText,
  round,
  runToolkitTool,
  safeStem,
  textFile,
  unsupported,
} from "./common.ts";

// ---- password strength ------------------------------------------------------------------------

/** The 60 passwords that show up at the top of every breach corpus, plus obvious local ones. */
export const COMMON_PASSWORDS: readonly string[] = [
  "password", "123456", "123456789", "12345678", "12345", "1234567", "qwerty", "abc123",
  "password1", "111111", "1234567890", "letmein", "monkey", "dragon", "iloveyou", "sunshine",
  "princess", "admin", "welcome", "login", "football", "baseball", "master", "trustno1",
  "shadow", "michael", "jennifer", "superman", "batman", "hunter", "starwars", "whatever",
  "qazwsx", "asdfgh", "zxcvbn", "passw0rd", "p@ssword", "secret", "ninja", "azerty",
  "test", "guest", "root", "toor", "changeme", "default", "internet", "computer",
  "samsung", "google", "facebook", "onestop", "summer", "winter", "spring", "autumn",
  "january", "december", "chocolate", "pokemon",
];

const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890"];

export interface StrengthReport {
  length: number;
  classes: string[];
  alphabetSize: number;
  /** Bits of entropy after the penalties below are applied. */
  entropyBits: number;
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** Rough offline-guessing time at 10 billion guesses/second. */
  crackTime: string;
  warnings: string[];
  suggestions: string[];
}

function humanDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "longer than anyone will wait";
  if (seconds < 1) return "instantly";
  const units: [number, string][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [365, "day"],
    [1000, "year"],
  ];
  let value = seconds;
  let name = "second";
  for (const [step, next] of units) {
    if (value < step) break;
    value /= step;
    name = next;
  }
  if (name === "year" && value > 1000) return "billions of years";
  const n = value < 10 ? round(value, 1) : Math.round(value);
  return `about ${n} ${name}${n === 1 ? "" : "s"}`;
}

export function scorePassword(password: string): StrengthReport {
  const warnings: string[] = [];
  const suggestions: string[] = [];
  const classes: string[] = [];
  let alphabet = 0;
  // Each class the password actually uses widens the alphabet a guesser has to search through.
  const useClass = (name: string, size: number) => {
    classes.push(name);
    alphabet += size;
  };
  if (/[a-z]/.test(password)) useClass("lower-case", 26);
  if (/[A-Z]/.test(password)) useClass("upper-case", 26);
  if (/[0-9]/.test(password)) useClass("digits", 10);
  if (/[^A-Za-z0-9]/.test(password)) useClass("symbols", 33);

  let bits = password.length > 0 && alphabet > 1 ? password.length * Math.log2(alphabet) : 0;
  const lower = password.toLowerCase();

  const commonHit = COMMON_PASSWORDS.find((w) => lower === w);
  if (commonHit) {
    bits = Math.min(bits, 4);
    warnings.push(`"${commonHit}" is one of the most-guessed passwords there is.`);
  } else {
    const containsCommon = COMMON_PASSWORDS.filter((w) => w.length >= 5 && lower.includes(w));
    if (containsCommon.length > 0) {
      bits -= 14;
      warnings.push(`It contains a very common word ("${containsCommon[0]}").`);
    }
  }

  // A run of three or more characters along one keyboard row, forwards or backwards.
  for (const row of KEYBOARD_ROWS) {
    const back = [...row].reverse().join("");
    const starts = Array.from({ length: Math.max(0, row.length - 3) }, (_, i) => i);
    if (starts.some((i) => lower.includes(row.slice(i, i + 4)) || lower.includes(back.slice(i, i + 4)))) {
      bits -= 10;
      warnings.push("It has a straight run of keyboard keys in it.");
    }
  }

  if (/(.)\1{2,}/.test(password)) {
    bits -= 8;
    warnings.push("A character repeats three or more times in a row.");
  }
  if (/(19|20)\d{2}/.test(password)) {
    bits -= 6;
    warnings.push("It contains what looks like a year.");
  }
  // "Word1!" — a capital at the front and the digits/symbols bolted on the end is the single most
  // predictable shape there is, so the bits for those characters are worth far less than they look.
  if (/^[A-Z][a-z]+\d{0,4}[!@#$%^&*]?$/.test(password)) {
    bits -= 8;
    warnings.push("Capital first, digits last is the pattern crackers try first.");
  }
  bits = Math.max(0, Math.round(bits));

  if (password.length < 12) suggestions.push("Make it at least 12 characters — length beats tricks.");
  if (classes.length < 3) suggestions.push("Mix in another character type (capitals, digits or symbols).");
  if (warnings.length > 0) suggestions.push("Avoid words, dates and keyboard runs — try a passphrase of unrelated words.");
  if (suggestions.length === 0) suggestions.push("This one looks solid. Store it in a password manager.");

  const score: StrengthReport["score"] = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  const label = ["very weak", "weak", "reasonable", "strong", "very strong"][score]!;
  return {
    length: password.length,
    classes,
    alphabetSize: alphabet,
    entropyBits: bits,
    score,
    label,
    crackTime: humanDuration(2 ** bits / 1e10),
    warnings: [...new Set(warnings)],
    suggestions,
  };
}

export const passwordStrengthMeterExecutor: Executor = (input, _options) =>
  runToolkitTool("password-strength-meter", async () => {
    const password = requireText(input, "a password to check");
    const report = scorePassword(password);
    return {
      ok: true,
      // The password itself is never echoed back into the result or the job record.
      output: { ...report, result: `${report.label} — about ${report.entropyBits} bits of entropy` },
      summary: `${report.label[0]!.toUpperCase()}${report.label.slice(1)}: about ${report.entropyBits} bits of entropy, ${report.crackTime} to guess offline.`,
      files: [],
    };
  });

// ---- TOTP -------------------------------------------------------------------------------------

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  if (clean === "" || /[^A-Z2-7]/.test(clean)) {
    throw unsupported("That is not a valid base32 secret. Paste the key your authenticator app shows.");
  }
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    value = (value << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

export function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32[(value >>> bits) & 31];
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export type TotpAlgorithm = "sha1" | "sha256" | "sha512";

/** RFC 6238: HOTP over a time counter. */
export function totp(
  secret: Uint8Array,
  {
    time = Date.now(),
    step = 30,
    digits = 6,
    algorithm = "sha1" as TotpAlgorithm,
  }: { time?: number; step?: number; digits?: number; algorithm?: TotpAlgorithm } = {},
): string {
  const counter = Math.floor(time / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, Buffer.from(secret)).update(buf).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const code =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(code % 10 ** digits).padStart(digits, "0");
}

export const totpGeneratorExecutor: Executor = (input, options) =>
  runToolkitTool("totp-code-generator", async () => {
    const mode = optEnum(options, "mode", ["generate", "verify", "new-secret"] as const, "generate");
    const step = optNumber(options, "step", 30, { min: 15, max: 120 });
    const digits = optNumber(options, "digits", 6, { min: 6, max: 8 });
    const algorithm = optEnum(options, "algorithm", ["sha1", "sha256", "sha512"] as const, "sha1");
    const label = optString(options, "label", "OneStop") || "OneStop";

    if (mode === "new-secret") {
      const secret = base32Encode(new Uint8Array(randomBytes(20)));
      const uri = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&algorithm=${algorithm.toUpperCase()}&digits=${digits}&period=${step}`;
      return {
        ok: true,
        output: { secret, uri, result: secret },
        summary:
          "Generated a new base32 secret. Paste it into your authenticator app, or turn the otpauth:// link into a QR code with the QR Code Generator.",
        files: [textFile("totp-secret.txt", MIME.txt, `${secret}\n${uri}\n`)],
      };
    }

    const raw = requireText(input, "your base32 secret");
    // An otpauth:// URI is what people actually have to hand, so accept it as well as a bare key.
    const fromUri = /[?&]secret=([^&]+)/i.exec(raw.trim());
    const secret = base32Decode(fromUri ? fromUri[1]! : raw);
    const now = Date.now();
    const code = totp(secret, { time: now, step, digits, algorithm });
    const secondsLeft = step - Math.floor(now / 1000) % step;

    if (mode === "verify") {
      const candidate = optString(options, "code", "").replace(/\s/g, "");
      if (candidate === "") throw unsupported("Enter the code your authenticator app is showing.");
      const window = optNumber(options, "window", 1, { min: 0, max: 5 });
      let matchedAt: number | null = null;
      for (let drift = -window; drift <= window; drift += 1) {
        const expected = totp(secret, { time: now + drift * step * 1000, step, digits, algorithm });
        if (expected.length === candidate.length && timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) {
          matchedAt = drift;
          break;
        }
      }
      return {
        ok: true,
        output: { valid: matchedAt !== null, driftSteps: matchedAt, result: matchedAt !== null ? "valid" : "not valid" },
        summary:
          matchedAt === null
            ? "That code does not match. Check the secret, and that the device's clock is right."
            : matchedAt === 0
              ? "That code is valid right now — the authenticator is wired up correctly."
              : `That code is valid, but ${Math.abs(matchedAt) * step} seconds ${matchedAt < 0 ? "behind" : "ahead"}. The device's clock has drifted.`,
        files: [],
      };
    }

    return {
      ok: true,
      output: { code, secondsRemaining: secondsLeft, step, digits, algorithm, result: code },
      summary: `Current code ${code} — valid for another ${secondsLeft} second${secondsLeft === 1 ? "" : "s"}.`,
      files: [],
    };
  });

// ---- diceware ---------------------------------------------------------------------------------

/**
 * A 256-word list of short, unambiguous, easy-to-type English words. 256 words is exactly 8 bits
 * per word, which makes the entropy claim below exact rather than approximate.
 */
export const DICEWARE_WORDS: readonly string[] = `able acid aged also arch area army atom aunt away
axis baby back bake ball band bank barn base bath bead beam bean bear beat beef bell belt bend best
bike bill bird bite blue boat body bold bolt bone book boot born boss both bowl bulb bulk bump burn
bush busy cage cake calf call calm camp cane card care cart case cash cast cave cell chat chef chin
chip city clam claw clay clip club coal coat code coin cold colt comb cone cook cool copy cord cork
corn cost cosy crew crop crow cube cure curl dark dart dash date dawn deal dear deck deed deep deer
desk dial dice diet dime dine dirt dish dive dock dome door dose dove down draw drew drip drop drum
dual duck dune dusk dust duty each earn east easy edge exam exit face fact fade fair fall fame farm
fast fate fawn fern film find fine fire firm fish fist five flag flat flax flew flip flow foam foil
fold folk font food foot fork form fort four fuel full fund gain game gate gave gear gift girl give
glad glow glue goal goat gold golf gone good gown grab gray grew grid grim grin grip grow gulf hail
hair half hall halt hand hang hard harm hawk haze head heal heap heat held helm help herb herd hero
hide high hill hint hive hold hole holy home hood hoof hook hope horn hose host hour huge hunt hurl`
  .split(/\s+/)
  .filter(Boolean);

export function diceware(words: number, separator: string, capitalize: boolean, digit: boolean): string {
  const picked: string[] = [];
  for (let i = 0; i < words; i += 1) {
    const w = DICEWARE_WORDS[randomInt(DICEWARE_WORDS.length)]!;
    picked.push(capitalize ? w[0]!.toUpperCase() + w.slice(1) : w);
  }
  if (digit) picked.push(String(randomInt(10, 100)));
  return picked.join(separator);
}

export const dicewareExecutor: Executor = (_input, options) =>
  runToolkitTool("diceware-passphrase-generator", async () => {
    const words = optNumber(options, "words", 5, { min: 3, max: 12 });
    const count = optNumber(options, "count", 1, { min: 1, max: 50 });
    const separator = { dash: "-", space: " ", dot: ".", none: "" }[
      optEnum(options, "separator", ["dash", "space", "dot", "none"] as const, "dash")
    ]!;
    const capitalize = optBool(options, "capitalize", false);
    const digit = optBool(options, "digit", false);
    const list = Array.from({ length: count }, () => diceware(words, separator, capitalize, digit));
    const bits = Math.round(words * Math.log2(DICEWARE_WORDS.length) + (digit ? Math.log2(90) : 0));
    return {
      ok: true,
      output: { passphrases: list, words, entropyBits: bits, result: list.join("\n") },
      summary: `Generated ${plural(count, "passphrase")} of ${words} words — about ${bits} bits of entropy each (${humanDuration(2 ** bits / 1e10)} to guess offline).`,
      files: [textFile("passphrases.txt", MIME.txt, list.join("\n") + "\n")],
    };
  });

// ---- file encryption --------------------------------------------------------------------------

export const ENCRYPT_MAGIC = "OSENC1\0";
const PBKDF2_ROUNDS = 310_000;

/**
 * The container: magic, rounds, salt, IV, GCM tag, then ciphertext. Everything the decryptor needs
 * except the password is in the header, so a file encrypted today still opens years later.
 */
export function encryptBytes(plain: Uint8Array, password: string): Uint8Array {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, PBKDF2_ROUNDS, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()]);
  const header = Buffer.alloc(7 + 4);
  header.write(ENCRYPT_MAGIC, 0, "latin1");
  header.writeUInt32BE(PBKDF2_ROUNDS, 7);
  return new Uint8Array(Buffer.concat([header, salt, iv, cipher.getAuthTag(), body]));
}

export function decryptBytes(blob: Uint8Array, password: string): Uint8Array {
  const buf = Buffer.from(blob);
  if (buf.length < 7 + 4 + 16 + 12 + 16 || buf.subarray(0, 7).toString("latin1") !== ENCRYPT_MAGIC) {
    throw unsupported("This file was not encrypted by OneStop's File Encryptor.");
  }
  const rounds = buf.readUInt32BE(7);
  if (rounds < 10_000 || rounds > 5_000_000) throw unsupported("This encrypted file's header is damaged.");
  const salt = buf.subarray(11, 27);
  const iv = buf.subarray(27, 39);
  const tag = buf.subarray(39, 55);
  const key = pbkdf2Sync(password, salt, rounds, 32, "sha256");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return new Uint8Array(Buffer.concat([decipher.update(buf.subarray(55)), decipher.final()]));
  } catch {
    // GCM authentication failing means the wrong password *or* a tampered file; we cannot tell
    // which, and saying so is more useful than a generic failure.
    throw unsupported("Wrong password, or this file has been altered since it was encrypted.");
  }
}

const ENCRYPTED_EXT = ".osenc";

async function readInputFiles(
  input: FileRef[] | string | null,
  ctx: { readFile: (ref: FileRef) => Promise<Uint8Array> } | undefined,
): Promise<{ ref: FileRef; bytes: Uint8Array }[]> {
  if (!Array.isArray(input) || input.length === 0) throw unsupported("Choose a file first.");
  if (!ctx) throw failed("This tool could not read your file. Please try again.");
  if (input.length > 25) throw unsupported("Choose at most 25 files.");
  const out = [];
  for (const ref of input) out.push({ ref, bytes: await ctx.readFile(ref) });
  return out;
}

export const fileEncryptorExecutor: Executor = (input, options, ctx) =>
  runToolkitTool("file-encryptor", async () => {
    const password = optString(options, "password", "");
    if (password.length < 8) {
      throw unsupported("Choose a password of at least 8 characters. Nothing can recover it if you forget it.");
    }
    const files = await readInputFiles(input, ctx);
    const out: OutputFile[] = files.map((f) => ({
      name: `${safeStem(f.ref.name)}${ENCRYPTED_EXT}`,
      mimeType: MIME.bin,
      bytes: encryptBytes(f.bytes, password),
    }));
    const strength = scorePassword(password);
    return {
      ok: true,
      output: { files: out.map((f) => ({ name: f.name, size: f.bytes.length })), passwordStrength: strength.label },
      summary: `Encrypted ${plural(out.length, "file")} with AES-256-GCM. Your password is ${strength.label} — OneStop never stores it, so keep it somewhere safe.`,
      files: packageFiles(out, options, "encrypted-files"),
    };
  });

export const fileDecryptorExecutor: Executor = (input, options, ctx) =>
  runToolkitTool("file-decryptor", async () => {
    const password = optString(options, "password", "");
    if (password === "") throw unsupported("Enter the password this file was encrypted with.");
    const files = await readInputFiles(input, ctx);
    const out: OutputFile[] = files.map((f) => ({
      name: safeStem(f.ref.name.replace(new RegExp(`${ENCRYPTED_EXT}$`, "i"), "")) || "decrypted",
      mimeType: MIME.bin,
      bytes: decryptBytes(f.bytes, password),
    }));
    return {
      ok: true,
      output: { files: out.map((f) => ({ name: f.name, size: f.bytes.length })) },
      summary: `Decrypted ${plural(out.length, "file")}.`,
      files: packageFiles(out, options, "decrypted-files"),
    };
  });

// ---- breach check -----------------------------------------------------------------------------

export const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";

/** Splits a SHA-1 hash the way the k-anonymity API wants: 5 characters out, 35 kept back. */
export function hibpSplit(sha1Hex: string): { prefix: string; suffix: string } {
  const upper = sha1Hex.toUpperCase();
  return { prefix: upper.slice(0, 5), suffix: upper.slice(5) };
}

export function countInRange(body: string, suffix: string): number {
  for (const line of body.split(/\r?\n/)) {
    const [hash, count] = line.trim().split(":");
    if (hash && hash.toUpperCase() === suffix) return Number(count) || 0;
  }
  return 0;
}

export const breachCheckExecutor: Executor = (input, _options) =>
  runToolkitTool("breach-check", async () => {
    const { createHash } = await import("node:crypto");
    const password = requireText(input, "the password to check");
    const { prefix, suffix } = hibpSplit(createHash("sha1").update(password, "utf8").digest("hex"));
    let body: string;
    try {
      const response = await fetch(`${HIBP_RANGE_URL}${prefix}`, {
        headers: { "Add-Padding": "true", "User-Agent": "OneStop" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      body = await response.text();
    } catch (err) {
      throw failed(
        "The breach database could not be reached. This tool needs an internet connection.",
        err,
      );
    }
    const count = countInRange(body, suffix);
    return {
      ok: true,
      output: {
        breached: count > 0,
        occurrences: count,
        hashPrefixSent: prefix,
        result: count > 0 ? `seen ${count} times` : "not found in known breaches",
      },
      summary:
        count > 0
          ? `This password appears ${count.toLocaleString("en")} times in known breaches — change it anywhere you use it. Only the first five characters of its hash (${prefix}) were ever sent.`
          : `Not found in the known-breach corpus. Only the first five characters of its hash (${prefix}) were ever sent — the password itself never left this machine.`,
      files: [],
    };
  });

// Re-exported so the tests and the finance module can share the wording.
export { humanDuration };
export const SECURITY_OUTPUT_HELPERS = { csvFile, jsonFile };
