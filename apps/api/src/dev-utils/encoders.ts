// Base64 and URL encoding/decoding (12-dev-utility-tools.md §12.10-12.13).
//
// Base64 works on bytes, so the encoder takes either typed text (encoded as UTF-8) or any
// uploaded file; the decoder gives back text when the bytes are valid UTF-8 and a file otherwise.
// Both understand the URL-safe alphabet and `data:` URLs, because that is what people actually
// paste in.
import type { Executor } from "@onestop/tool-registry";
import type { FileRef, OutputFile } from "@onestop/types";
import {
  MIME,
  bytesLabel,
  optBool,
  optEnum,
  optNumber,
  optString,
  readFiles,
  runUtilTool,
  safeStem,
  textFile,
  unsupported,
} from "./common.ts";

// ---- Base64 -----------------------------------------------------------------------------------

export type Base64Variant = "standard" | "urlsafe";

export function encodeBase64(
  bytes: Uint8Array,
  { variant = "standard", wrap = 0 }: { variant?: Base64Variant; wrap?: number } = {},
): string {
  let text = Buffer.from(bytes).toString("base64");
  if (variant === "urlsafe") text = text.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (wrap > 0) text = (text.match(new RegExp(`.{1,${wrap}}`, "g")) ?? []).join("\n");
  return text;
}

export interface DecodedBase64 {
  bytes: Uint8Array;
  /** MIME type, when the input was a `data:` URL. */
  dataUrlMime?: string;
}

const BASE64_CHARS = /^[A-Za-z0-9+/\-_]*={0,2}$/;

export function decodeBase64(input: string): DecodedBase64 {
  let text = input.trim();
  let dataUrlMime: string | undefined;
  const dataUrl = /^data:([^;,]*)(;[^,]*)?,/.exec(text);
  if (dataUrl) {
    if (!/;base64/i.test(dataUrl[2] ?? "")) {
      throw unsupported("This data URL is not Base64-encoded, so there is nothing to decode.");
    }
    dataUrlMime = dataUrl[1] || undefined;
    text = text.slice(dataUrl[0].length);
  }
  const compact = text.replace(/\s+/g, "");
  if (compact === "") throw unsupported("Paste some Base64 first.");
  if (!BASE64_CHARS.test(compact)) {
    const bad = [...compact].find((c) => !/[A-Za-z0-9+/\-_=]/.test(c))!;
    throw unsupported(
      `This is not valid Base64 — it contains ${JSON.stringify(bad)} at position ${compact.indexOf(bad) + 1}.`,
    );
  }
  const normalised = compact.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
  const bytes = new Uint8Array(Buffer.from(padded, "base64"));
  // Node is lenient; re-encoding is how we tell truncated input from valid input.
  if (Buffer.from(bytes).toString("base64").replace(/=+$/, "") !== normalised.replace(/=+$/, "")) {
    throw unsupported(
      "This Base64 is incomplete or has stray characters. Check you copied it all.",
    );
  }
  return dataUrlMime ? { bytes, dataUrlMime } : { bytes };
}

/** Whether bytes round-trip through UTF-8 — the test for "this is text, show it as text". */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.includes("\uFFFD")) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text);
}

export const base64EncoderExecutor: Executor = (input, options, ctx) =>
  runUtilTool("base64-encoder", async () => {
    const variant = optEnum(options, "variant", ["standard", "urlsafe"] as const, "standard");
    const wrap = optNumber(options, "wrap", 0, { min: 0, max: 200 });
    const asDataUrl = optBool(options, "dataUrl", false);

    let bytes: Uint8Array;
    let stem = "encoded";
    let sourceMime = "text/plain";
    let sourceLabel: string;
    if (typeof input === "string") {
      if (input === "") throw unsupported("Enter some text or choose a file first.");
      bytes = new TextEncoder().encode(input);
      sourceLabel = `${input.length} characters of text`;
    } else {
      const [file] = await readFiles(input as FileRef[] | null, ctx);
      bytes = file!.bytes;
      stem = safeStem(file!.name, "encoded");
      sourceMime = file!.ref.type || "application/octet-stream";
      sourceLabel = `${file!.ref.name} (${bytesLabel(bytes.length)})`;
    }

    const encoded = encodeBase64(bytes, { variant, wrap });
    const result = asDataUrl ? `data:${sourceMime};base64,${encoded.replace(/\n/g, "")}` : encoded;
    return {
      ok: true,
      output: { variant, bytesIn: bytes.length, characters: result.length, result },
      summary: `Encoded ${sourceLabel} as ${result.length} Base64 characters${variant === "urlsafe" ? " (URL-safe alphabet)" : ""}.`,
      files: [textFile(`${stem}.b64.txt`, MIME.txt, result + "\n")],
    };
  });

export const base64DecoderExecutor: Executor = (input, options) =>
  runUtilTool("base64-decoder", async () => {
    if (typeof input !== "string" || input.trim() === "") {
      throw unsupported("Paste some Base64 first.");
    }
    const { bytes, dataUrlMime } = decodeBase64(input);
    const want = optEnum(options, "output", ["auto", "text", "file"] as const, "auto");
    const isText = looksLikeText(bytes);
    const asText = want === "text" || (want === "auto" && isText && !dataUrlMime);
    const stem = safeStem(optString(options, "fileName", "") || "decoded", "decoded");

    if (asText) {
      if (!isText && want === "text") {
        throw unsupported("This Base64 holds binary data, not text. Choose “Download as a file”.");
      }
      const text = new TextDecoder().decode(bytes);
      return {
        ok: true,
        output: { bytes: bytes.length, result: text },
        summary: `Decoded ${bytes.length} bytes of text.`,
        files: [textFile(`${stem}.txt`, MIME.txt, text)],
      };
    }

    const ext = extensionForMime(dataUrlMime) ?? "bin";
    const file: OutputFile = {
      name: `${stem}.${ext}`,
      mimeType: dataUrlMime ?? MIME.bin,
      bytes,
    };
    return {
      ok: true,
      output: { bytes: bytes.length, mimeType: dataUrlMime ?? null, text: false },
      summary: `Decoded ${bytesLabel(bytes.length)}${dataUrlMime ? ` of ${dataUrlMime}` : " of binary data"}.`,
      files: [file],
    };
  });

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "text/plain": "txt",
  "text/html": "html",
  "text/csv": "csv",
  "application/json": "json",
  "audio/mpeg": "mp3",
  "video/mp4": "mp4",
};

function extensionForMime(mime: string | undefined): string | undefined {
  if (!mime) return undefined;
  return EXT_BY_MIME[mime.split(";")[0]!.trim().toLowerCase()];
}

// ---- URL --------------------------------------------------------------------------------------

export type UrlMode = "component" | "uri" | "form";

export function encodeUrl(text: string, mode: UrlMode): string {
  if (mode === "uri") return encodeURI(text);
  if (mode === "form") return encodeURIComponent(text).replace(/%20/g, "+");
  return encodeURIComponent(text);
}

export function decodeUrl(text: string, mode: UrlMode): string {
  const prepared = mode === "form" ? text.replace(/\+/g, " ") : text;
  try {
    return mode === "uri" ? decodeURI(prepared) : decodeURIComponent(prepared);
  } catch {
    const bad = /%(?![0-9a-fA-F]{2})/.exec(prepared);
    throw unsupported(
      bad
        ? `This is not a valid percent-encoded string: the "%" at position ${bad.index + 1} is not followed by two hex digits.`
        : "This is not a valid percent-encoded string. Check you copied all of it.",
    );
  }
}

/** Breaks a URL into its parts, so the result says what was encoded, not just how long it is. */
export function describeUrl(text: string): Record<string, unknown> | null {
  try {
    const url = new URL(text);
    return {
      protocol: url.protocol.replace(":", ""),
      host: url.host,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      hash: url.hash.replace("#", ""),
    };
  } catch {
    return null;
  }
}

function urlToolExecutor(toolId: string, direction: "encode" | "decode"): Executor {
  return (input, options) =>
    runUtilTool(toolId, async () => {
      if (typeof input !== "string" || input.trim() === "") {
        throw unsupported(direction === "encode" ? "Enter some text first." : "Paste a URL first.");
      }
      const mode = optEnum(options, "mode", ["component", "uri", "form"] as const, "component");
      const perLine = optBool(options, "perLine", false);
      const apply = (t: string) =>
        direction === "encode" ? encodeUrl(t, mode) : decodeUrl(t, mode);
      const result = perLine ? input.split(/\r?\n/).map(apply).join("\n") : apply(input);
      const parts = direction === "decode" ? describeUrl(result) : describeUrl(input);
      return {
        ok: true,
        output: { mode, result, ...(parts ? { parts } : {}) },
        summary: `${direction === "encode" ? "Encoded" : "Decoded"} ${input.length} characters${perLine ? ", line by line" : ""}.`,
        files: [textFile(`url-${direction}d.txt`, MIME.txt, result + "\n")],
      };
    });
}

export const urlEncoderExecutor = urlToolExecutor("url-encoder", "encode");
export const urlDecoderExecutor = urlToolExecutor("url-decoder", "decode");
