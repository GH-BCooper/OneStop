// UUID and password generation (12-dev-utility-tools.md §12.14-12.15).
//
// Every random value here comes from `node:crypto` — `randomUUID`, `randomBytes` and
// `randomInt` — which is the platform CSPRNG. `Math.random()` is never used, and the rejection
// sampling in `randomInt` is what keeps the character choice uniform (a plain `% length` would
// quietly bias passwords towards the start of the alphabet).
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { Executor } from "@onestop/tool-registry";
import { MIME, optBool, optEnum, optNumber, runUtilTool, textFile } from "./common.ts";

// ---- UUIDs ------------------------------------------------------------------------------------

export type UuidVersion = "v4" | "v7" | "nil";

/**
 * A version 7 UUID: 48 bits of Unix time in milliseconds, then 74 random bits. Sorting a list of
 * them sorts by creation time, which is why they are worth having next to v4.
 */
export function uuidV7(now = Date.now(), random = randomBytes): string {
  const bytes = new Uint8Array(random(16));
  const ms = BigInt(now);
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface UuidFormat {
  uppercase?: boolean;
  hyphens?: boolean;
  braces?: boolean;
}

export function formatUuid(uuid: string, format: UuidFormat = {}): string {
  let out = format.hyphens === false ? uuid.replace(/-/g, "") : uuid;
  if (format.uppercase) out = out.toUpperCase();
  if (format.braces) out = `{${out}}`;
  return out;
}

export function generateUuids(
  count: number,
  version: UuidVersion,
  format: UuidFormat = {},
): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const raw =
      version === "nil"
        ? "00000000-0000-0000-0000-000000000000"
        : version === "v7"
          ? uuidV7()
          : randomUUID();
    out.push(formatUuid(raw, format));
  }
  return out;
}

export const uuidGeneratorExecutor: Executor = (_input, options) =>
  runUtilTool("uuid-generator", async () => {
    const count = optNumber(options, "count", 1, { min: 1, max: 1000 });
    const version = optEnum(options, "version", ["v4", "v7", "nil"] as const, "v4");
    const uuids = generateUuids(count, version, {
      uppercase: optBool(options, "uppercase", false),
      hyphens: !optBool(options, "noHyphens", false),
      braces: optBool(options, "braces", false),
    });
    const kind =
      version === "v4"
        ? "random (version 4)"
        : version === "v7"
          ? "time-ordered (version 7)"
          : "nil";
    return {
      ok: true,
      output: { version, count, uuids, result: uuids.join("\n") },
      summary: `Generated ${count} ${kind} UUID${count === 1 ? "" : "s"}.`,
      files: [textFile("uuids.txt", MIME.txt, uuids.join("\n") + "\n")],
    };
  });

// ---- passwords --------------------------------------------------------------------------------

export const CHARSETS = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/",
} as const;

/** Characters people misread when copying a password off a screen. */
export const AMBIGUOUS = "Il1O0o5S2Z8B|`'\"{}[]()/\\";

export interface PasswordOptions {
  length?: number;
  lower?: boolean;
  upper?: boolean;
  digits?: boolean;
  symbols?: boolean;
  avoidAmbiguous?: boolean;
}

export interface PasswordSet {
  alphabet: string;
  /** One required class per enabled set, so every password really uses all of them. */
  required: string[];
}

export function buildAlphabet(options: PasswordOptions): PasswordSet {
  const enabled: string[] = [];
  if (options.lower !== false) enabled.push(CHARSETS.lower);
  if (options.upper !== false) enabled.push(CHARSETS.upper);
  if (options.digits !== false) enabled.push(CHARSETS.digits);
  if (options.symbols) enabled.push(CHARSETS.symbols);
  const filter = (set: string) =>
    options.avoidAmbiguous ? [...set].filter((c) => !AMBIGUOUS.includes(c)).join("") : set;
  const required = enabled.map(filter).filter((s) => s.length > 0);
  return { alphabet: required.join(""), required };
}

function pick(set: string): string {
  return set[randomInt(set.length)]!;
}

export function generatePassword(options: PasswordOptions = {}): string {
  const length = options.length ?? 20;
  const { alphabet, required } = buildAlphabet(options);
  if (alphabet.length === 0) {
    throw new Error("no character sets enabled");
  }
  // Guarantee one character from each enabled set, then fill and shuffle (Fisher-Yates with a
  // CSPRNG) so the guaranteed characters are not always at the front.
  const chars: string[] = required.slice(0, length).map(pick);
  while (chars.length < length) chars.push(pick(alphabet));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

/** Shannon entropy of the *generator*, in bits — the honest measure for a random password. */
export function passwordEntropy(length: number, alphabetSize: number): number {
  if (alphabetSize <= 1 || length <= 0) return 0;
  return Math.round(length * Math.log2(alphabetSize));
}

export function strengthLabel(bits: number): string {
  if (bits < 40) return "weak";
  if (bits < 60) return "reasonable";
  if (bits < 80) return "strong";
  return "very strong";
}

export const passwordGeneratorExecutor: Executor = (_input, options) =>
  runUtilTool("password-generator", async () => {
    const length = optNumber(options, "length", 20, { min: 4, max: 128 });
    const count = optNumber(options, "count", 1, { min: 1, max: 100 });
    const settings: PasswordOptions = {
      length,
      lower: optBool(options, "lower", true),
      upper: optBool(options, "upper", true),
      digits: optBool(options, "digits", true),
      symbols: optBool(options, "symbols", true),
      avoidAmbiguous: optBool(options, "avoidAmbiguous", false),
    };
    const { alphabet } = buildAlphabet(settings);
    if (alphabet.length === 0) {
      return {
        ok: false,
        code: "UNSUPPORTED_INPUT",
        message: "Turn on at least one character type (letters, digits or symbols).",
      };
    }
    const passwords = Array.from({ length: count }, () => generatePassword(settings));
    const bits = passwordEntropy(length, alphabet.length);
    return {
      ok: true,
      output: {
        count,
        length,
        alphabetSize: alphabet.length,
        entropyBits: bits,
        strength: strengthLabel(bits),
        passwords,
        result: passwords.join("\n"),
      },
      summary: `Generated ${count} ${length}-character password${count === 1 ? "" : "s"} from ${alphabet.length} possible characters — about ${bits} bits of entropy (${strengthLabel(bits)}).`,
      files: [textFile("passwords.txt", MIME.txt, passwords.join("\n") + "\n")],
    };
  });
