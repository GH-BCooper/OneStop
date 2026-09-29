// JWT Decoder/Debugger (21-roadmap-expansion.md, roadmap §1.8).
//
// Decoding a JWT is base64url and JSON, so this needs nothing but `node:crypto` for the optional
// HMAC check. Deliberately *not* implemented: fetching a JWKS to verify RS256/ES256, which would
// make an offline tool reach the network. A token signed that way is decoded and its claims are
// checked; the signature is reported as "not verified here" rather than silently passed.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Executor } from "@onestop/tool-registry";
import { MIME, optString, requireText, runUtilTool, textFile, unsupported } from "./common.ts";

export function base64UrlDecode(segment: string): Uint8Array {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  if (/[^A-Za-z0-9+/=]/.test(padded)) throw unsupported("This token is not valid base64url.");
  return new Uint8Array(Buffer.from(padded + pad, "base64"));
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The registered claims worth naming in plain English, in the order people read them. */
const CLAIM_LABELS: Record<string, string> = {
  iss: "Issuer",
  sub: "Subject",
  aud: "Audience",
  exp: "Expires",
  nbf: "Not valid before",
  iat: "Issued at",
  jti: "Token id",
  scope: "Scope",
  azp: "Authorised party",
  email: "Email",
  name: "Name",
};

const TIME_CLAIMS = ["exp", "nbf", "iat", "auth_time", "updated_at"];

export type SignatureState = "valid" | "invalid" | "not-checked" | "unsupported";

export interface JwtReport {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signatureBytes: number;
  algorithm: string;
  times: { claim: string; label: string; iso: string; relative: string }[];
  expired: boolean;
  notYetValid: boolean;
  signature: SignatureState;
  notes: string[];
}

function relative(seconds: number, now: number): string {
  const delta = seconds * 1000 - now;
  const abs = Math.abs(delta);
  const units: [number, string][] = [
    [1000, "second"],
    [60, "minute"],
    [60, "hour"],
    [24, "day"],
  ];
  let value = abs;
  let name = "millisecond";
  for (const [step, next] of units) {
    if (value < step) break;
    value /= step;
    name = next;
  }
  const n = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return delta >= 0 ? `in ${n} ${name}${n === 1 ? "" : "s"}` : `${n} ${name}${n === 1 ? "" : "s"} ago`;
}

export function decodeJwt(token: string, secret = "", now = Date.now()): JwtReport {
  const parts = token.trim().replace(/^Bearer\s+/i, "").split(".");
  if (parts.length !== 3) {
    throw unsupported("A JWT has three dot-separated parts. Paste the whole token, header included.");
  }
  const parse = (segment: string, what: string): Record<string, unknown> => {
    let text: string;
    try {
      text = new TextDecoder().decode(base64UrlDecode(segment));
    } catch {
      throw unsupported(`This token's ${what} is not valid base64url.`);
    }
    try {
      const value = JSON.parse(text) as unknown;
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("not an object");
      }
      return value as Record<string, unknown>;
    } catch {
      throw unsupported(`This token's ${what} is not JSON. It may not be a JWT.`);
    }
  };
  const header = parse(parts[0]!, "header");
  const payload = parse(parts[1]!, "claims");
  const algorithm = String(header.alg ?? "none");
  const notes: string[] = [];

  const times = TIME_CLAIMS.filter((c) => typeof payload[c] === "number").map((claim) => {
    const seconds = payload[claim] as number;
    return {
      claim,
      label: CLAIM_LABELS[claim] ?? claim,
      iso: new Date(seconds * 1000).toISOString(),
      relative: relative(seconds, now),
    };
  });
  const exp = typeof payload.exp === "number" ? payload.exp * 1000 : null;
  const nbf = typeof payload.nbf === "number" ? payload.nbf * 1000 : null;
  const expired = exp !== null && exp <= now;
  const notYetValid = nbf !== null && nbf > now;
  if (exp === null) notes.push("This token has no expiry claim, so it never goes stale on its own.");
  if (algorithm.toLowerCase() === "none") {
    notes.push('The algorithm is "none": this token is not signed at all. Never trust one of these.');
  }

  let signature: SignatureState = "not-checked";
  const hmacBits = /^HS(256|384|512)$/i.exec(algorithm);
  if (secret !== "" && hmacBits) {
    const expectedBuf = createHmac(`sha${hmacBits[1]}`, secret)
      .update(`${parts[0]}.${parts[1]}`)
      .digest();
    const actual = Buffer.from(base64UrlDecode(parts[2]!));
    signature =
      actual.length === expectedBuf.length && timingSafeEqual(actual, expectedBuf) ? "valid" : "invalid";
  } else if (secret !== "") {
    signature = "unsupported";
    notes.push(
      `${algorithm} is a public-key signature, so checking it needs the issuer's public key — OneStop will not fetch one, because that would make this tool need the internet.`,
    );
  }

  return {
    header,
    payload,
    signatureBytes: base64UrlDecode(parts[2]!).length,
    algorithm,
    times,
    expired,
    notYetValid,
    signature,
    notes,
  };
}

export const jwtDecoderExecutor: Executor = (input, options) =>
  runUtilTool("jwt-decoder", async () => {
    const token = requireText(input, "a JWT");
    const report = decodeJwt(token, optString(options, "secret", ""));
    const state = report.expired
      ? "expired"
      : report.notYetValid
        ? "not valid yet"
        : report.times.some((t) => t.claim === "exp")
          ? "still valid"
          : "no expiry set";
    const signatureNote =
      report.signature === "valid"
        ? " The signature matches the secret you gave."
        : report.signature === "invalid"
          ? " The signature does NOT match the secret you gave."
          : "";
    return {
      ok: true,
      output: {
        ...report,
        result: JSON.stringify({ header: report.header, payload: report.payload }, null, 2),
      },
      summary: `${report.algorithm} token, ${state}.${signatureNote}${report.notes.length ? ` ${report.notes[0]}` : ""}`,
      files: [
        textFile(
          "jwt.json",
          MIME.json,
          JSON.stringify({ header: report.header, payload: report.payload }, null, 2) + "\n",
        ),
      ],
    };
  });
