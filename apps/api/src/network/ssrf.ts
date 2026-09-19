// Outbound request safety (CLAUDE.md §6, master plan §15, phase-16 hand-off note 4).
//
// Every phase-17 tool fetches something the *user* named, which is the classic SSRF surface: a
// link like `http://169.254.169.254/` or `http://localhost:5432/` would make the server attack
// itself. The rules here are the ones the hand-off note asks for, in order:
//
//   1. scheme allow-list (http/https only — no file:, gopher:, ftp:, data:)
//   2. no credentials in the URL, no non-standard ports
//   3. resolve the host and reject every address that is not publicly routable
//   4. follow at most a few redirects, re-running 1-3 on each hop
//   5. cap the response size and the total time
//
// Known limit: the check resolves the name, then `fetch` resolves it again to connect, so a DNS
// answer that changes between the two (classic rebinding) is not caught. Closing that would mean
// pinning the connection to the checked address, which needs a custom undici dispatcher — noted
// in PROGRESS.md rather than half-done here.
import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { classifyIp, parseIp } from "./ipAddress.ts";
import { failed, offline, outboundUserAgent, unsupported } from "./common.ts";

export const MAX_REDIRECTS = 4;
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export interface SafeUrl {
  url: URL;
  /** The addresses the host resolved to, all of them checked and publicly routable. */
  addresses: string[];
}

/** Ports a browser refuses, plus the databases and admin panels a self-hosted box usually runs. */
const BLOCKED_PORTS = new Set([
  22, 23, 25, 110, 143, 445, 465, 587, 993, 995, 1433, 1521, 2049, 3306, 3389, 5432, 5900, 6379,
  9200, 11211, 27017,
]);

export function parseSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw unsupported("Enter a full link starting with http:// or https://.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw unsupported("Only http:// and https:// links can be looked up.");
  }
  if (url.username !== "" || url.password !== "") {
    throw unsupported("Remove the username and password from the link and try again.");
  }
  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || BLOCKED_PORTS.has(port)) {
    throw unsupported("That port cannot be looked up. Use a normal web address.");
  }
  if (url.hostname === "") throw unsupported("That link has no host name.");
  return url;
}

/** Resolves the host and refuses anything that is not a public address. */
export async function resolveSafely(url: URL): Promise<string[]> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literal = parseIp(host);
  const candidates: string[] = [];

  if (literal) {
    candidates.push(literal.text);
  } else {
    let records: LookupAddress[];
    try {
      records = await dnsLookup(host, { all: true, verbatim: true });
    } catch (err) {
      // ENOTFOUND/ENODATA mean "this name does not exist"; EAI_AGAIN and the rest mean the
      // resolver itself could not be reached, which is the offline case.
      const code = (err as { code?: string }).code;
      if (code === "ENOTFOUND" || code === "ENODATA") {
        throw unsupported(`No site could be found at ${host}. Check the address and try again.`);
      }
      throw offline(err);
    }
    candidates.push(...records.map((r) => r.address));
  }

  if (candidates.length === 0) {
    throw unsupported(`No site could be found at ${host}. Check the address and try again.`);
  }
  for (const address of candidates) {
    const ip = parseIp(address);
    if (!ip || !classifyIp(ip).routable) {
      throw unsupported(
        "That address is on a private or local network, so OneStop will not open it.",
      );
    }
  }
  return candidates;
}

export async function checkUrl(raw: string): Promise<SafeUrl> {
  const url = parseSafeUrl(raw);
  return { url, addresses: await resolveSafely(url) };
}

export interface SafeFetchOptions {
  method?: "GET" | "HEAD" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Test seam: the fetch implementation to use. Defaults to the global one. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface SafeResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Every URL visited, in order, including the final one. */
  chain: { url: string; status: number }[];
  body: Uint8Array;
  /** True when the body was cut off at `maxBytes`. */
  truncated: boolean;
  /** The addresses the final host resolved to. */
  addresses: string[];
  elapsedMs: number;
}

export function decodeBody(response: Pick<SafeResponse, "headers" | "body">): string {
  const charset = /charset=["']?([\w-]+)/i.exec(response.headers["content-type"] ?? "")?.[1];
  const label = (charset ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(label === "iso-8859-1" ? "windows-1252" : label, {
      fatal: false,
    }).decode(response.body);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(response.body);
  }
}

/**
 * A fetch that obeys the rules above. Redirects are followed by hand (`redirect: "manual"`)
 * so each hop goes through `checkUrl` again — an allowed page that redirects to `127.0.0.1` is
 * stopped at the redirect, not after it.
 */
export async function safeFetch(
  raw: string,
  options: SafeFetchOptions = {},
): Promise<SafeResponse> {
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = MAX_REDIRECTS,
    fetchImpl = fetch,
    signal,
  } = options;

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  const chain: { url: string; status: number }[] = [];
  let target = raw;

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const { url, addresses } = await checkUrl(target);
      let response: Response;
      try {
        response = await fetchImpl(url.toString(), {
          method,
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "user-agent": outboundUserAgent(),
            accept: "*/*",
            "accept-language": "en",
            ...headers,
          },
          ...(body === undefined ? {} : { body }),
        });
      } catch (err) {
        if (controller.signal.aborted) {
          throw failed("That site took too long to answer. Try again in a moment.");
        }
        throw offline(err);
      }

      chain.push({ url: url.toString(), status: response.status });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        if (hop === maxRedirects) {
          throw failed("That link redirects too many times. Try the final address directly.");
        }
        target = new URL(location, url).toString();
        // Drain the redirect body so the socket is released.
        await response.arrayBuffer().catch(() => undefined);
        continue;
      }

      const collected = await readCapped(response, maxBytes);
      const headerMap: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headerMap[key.toLowerCase()] = value;
      });
      return {
        url: url.toString(),
        status: response.status,
        statusText: response.statusText,
        headers: headerMap,
        chain,
        body: collected.bytes,
        truncated: collected.truncated,
        addresses,
        elapsedMs: Date.now() - started,
      };
    }
    throw failed("That link redirects too many times. Try the final address directly.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return buffer.length > maxBytes
      ? { bytes: buffer.subarray(0, maxBytes), truncated: true }
      : { bytes: buffer, truncated: false };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.length > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total));
      total = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, truncated };
}
