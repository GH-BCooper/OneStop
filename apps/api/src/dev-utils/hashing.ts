// Hashing and checksums (12-dev-utility-tools.md §12.16, §14.9).
//
// `node:crypto` rather than Web Crypto: `crypto.subtle` has no MD5 at all (by design), and the
// build file asks for MD5 for legacy compatibility — checking a download against a vendor's
// published MD5 is exactly the case that still needs it. Everything is labelled so nobody uses
// MD5 or SHA-1 thinking they are secure.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Executor } from "@onestop/tool-registry";
import { crc32 } from "../pdf/zip.ts";
import {
  MIME,
  bytesLabel,
  optEnum,
  optString,
  readFiles,
  runUtilTool,
  safeStem,
  textFile,
  unsupported,
} from "./common.ts";

export const ALGORITHMS = ["md5", "sha1", "sha256", "sha384", "sha512", "crc32"] as const;
export type Algorithm = (typeof ALGORITHMS)[number];

export const ALGORITHM_LABELS: Record<Algorithm, string> = {
  md5: "MD5",
  sha1: "SHA-1",
  sha256: "SHA-256",
  sha384: "SHA-384",
  sha512: "SHA-512",
  crc32: "CRC-32",
};

/** Algorithms that are fine for integrity checks but must not be relied on for security. */
export const LEGACY: readonly Algorithm[] = ["md5", "sha1", "crc32"];

export type Digest = "hex" | "base64" | "base64url";

export function hashBytes(bytes: Uint8Array, algorithm: Algorithm, digest: Digest = "hex"): string {
  if (algorithm === "crc32") {
    const value = crc32(bytes).toString(16).padStart(8, "0");
    if (digest === "hex") return value;
    return Buffer.from(value, "hex").toString(digest === "base64" ? "base64" : "base64url");
  }
  return createHash(algorithm).update(bytes).digest(digest);
}

export function hashText(text: string, algorithm: Algorithm, digest: Digest = "hex"): string {
  return hashBytes(new TextEncoder().encode(text), algorithm, digest);
}

export function hmacText(
  text: string,
  key: string,
  algorithm: Algorithm,
  digest: Digest = "hex",
): string {
  if (algorithm === "crc32") {
    throw unsupported("CRC-32 is a checksum, not a keyed hash — choose SHA-256 for an HMAC.");
  }
  return createHmac(algorithm, key).update(text, "utf8").digest(digest);
}

/** Constant-time comparison of two hex digests, so a verification cannot be timed. */
export function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a.trim().toLowerCase(), "utf8");
  const right = Buffer.from(b.trim().toLowerCase(), "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const ALGORITHM_CHOICES = ["all", ...ALGORITHMS] as const;

function algorithmsFrom(options: Record<string, unknown>): Algorithm[] {
  const choice = optEnum(options, "algorithm", ALGORITHM_CHOICES, "sha256");
  return choice === "all" ? [...ALGORITHMS] : [choice as Algorithm];
}

function legacyNote(algorithms: Algorithm[]): string {
  const used = algorithms.filter((a) => LEGACY.includes(a) && a !== "crc32");
  if (used.length === 0) return "";
  return ` ${used.map((a) => ALGORITHM_LABELS[a]).join(" and ")} ${used.length === 1 ? "is" : "are"} fine for checking a file has not changed, but must not be used for passwords or signatures.`;
}

// ---- Hash Generator (text) --------------------------------------------------------------------

export const hashGeneratorExecutor: Executor = (input, options) =>
  runUtilTool("hash-generator", async () => {
    if (typeof input !== "string" || input === "") {
      throw unsupported("Enter some text to hash first.");
    }
    const algorithms = algorithmsFrom(options);
    const digest = optEnum(options, "digest", ["hex", "base64", "base64url"] as const, "hex");
    const key = optString(options, "hmacKey", "");

    const hashes: Record<string, string> = {};
    for (const algorithm of algorithms) {
      hashes[ALGORITHM_LABELS[algorithm]] = key
        ? hmacText(input, key, algorithm, digest)
        : hashText(input, algorithm, digest);
    }
    const lines = Object.entries(hashes).map(([name, value]) => `${name}: ${value}`);
    const only = algorithms.length === 1 ? hashes[ALGORITHM_LABELS[algorithms[0]!]]! : "";
    return {
      ok: true,
      output: { algorithms, digest, hmac: key !== "", hashes, ...(only ? { result: only } : {}) },
      summary:
        (key ? "HMAC of " : "Hashed ") +
        `${input.length} characters with ${algorithms.map((a) => ALGORITHM_LABELS[a]).join(", ")}.` +
        legacyNote(algorithms),
      files: [textFile("hashes.txt", MIME.txt, lines.join("\n") + "\n")],
    };
  });

// ---- Checksum Generator (files) ---------------------------------------------------------------

export interface FileChecksum {
  file: string;
  size: number;
  hashes: Record<string, string>;
}

/** The `sha256sum`/`md5sum` line format, so the result can be verified with the standard tools. */
export function sumFileText(rows: FileChecksum[], algorithm: Algorithm): string {
  const label = ALGORITHM_LABELS[algorithm];
  return rows.map((r) => `${r.hashes[label]}  ${r.file}`).join("\n") + "\n";
}

export const checksumGeneratorExecutor: Executor = (input, options, ctx) =>
  runUtilTool("checksum-generator", async () => {
    const files = await readFiles(input, ctx);
    const algorithms = algorithmsFrom(options);
    const digest = optEnum(options, "digest", ["hex", "base64", "base64url"] as const, "hex");
    const expected = optString(options, "expected", "").trim();

    const rows: FileChecksum[] = files.map((f) => ({
      file: f.ref.name,
      size: f.bytes.length,
      hashes: Object.fromEntries(
        algorithms.map((a) => [ALGORITHM_LABELS[a], hashBytes(f.bytes, a, digest)]),
      ),
    }));

    let verification: { expected: string; matched: string[]; ok: boolean } | undefined;
    if (expected !== "") {
      const matched = rows
        .filter((r) => Object.values(r.hashes).some((h) => digestsMatch(h, expected)))
        .map((r) => r.file);
      verification = { expected, matched, ok: matched.length > 0 };
    }

    const single = algorithms.length === 1 ? algorithms[0]! : null;
    const outputFiles = single
      ? [
          textFile(
            `${safeStem(files.length === 1 ? files[0]!.name : "checksums", "checksums")}.${single}`,
            MIME.txt,
            sumFileText(rows, single),
          ),
        ]
      : [
          textFile(
            "checksums.txt",
            MIME.txt,
            rows
              .map((r) =>
                [
                  `${r.file} (${bytesLabel(r.size)})`,
                  ...Object.entries(r.hashes).map(([k, v]) => `  ${k}: ${v}`),
                ].join("\n"),
              )
              .join("\n\n") + "\n",
          ),
        ];

    const verdict = verification
      ? verification.ok
        ? ` The expected checksum matches ${verification.matched.join(", ")}.`
        : " None of these files matches the expected checksum — the file may be corrupt or the wrong one."
      : "";
    return {
      ok: true,
      output: { algorithms, digest, files: rows, ...(verification ? { verification } : {}) },
      summary:
        `Checksummed ${files.length} file${files.length === 1 ? "" : "s"} with ${algorithms.map((a) => ALGORITHM_LABELS[a]).join(", ")}.` +
        verdict +
        legacyNote(algorithms),
      files: outputFiles,
    };
  });
