// The caller's address, as far as the deployment can tell.
//
// `x-forwarded-for` is a list: every proxy appends the address it received the request from, so the
// FIRST entry is whatever the client chose to send and only the entries a trusted proxy appended
// mean anything. Rate limits keyed on the first entry can be dodged by sending a fresh
// `X-Forwarded-For` with every request, so this reads the entry the nearest trusted proxy wrote.
//
// `TRUSTED_PROXY_HOPS` says how many proxies sit in front of the app (default 1: Render, Fly,
// Vercel, Railway, nginx). Put a CDN such as Cloudflare in front of that and set it to 2. `0` means
// "trust no forwarding header at all" - every caller then shares one bucket, which is the right
// answer for a server that is reachable directly.
export function trustedProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TRUSTED_PROXY_HOPS?.trim();
  if (raw === undefined || raw === "") return 1;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 10 ? parsed : 1;
}

const IP_SHAPE = /^[0-9a-f:.]{2,45}$/i;

export function clientIpOf(
  headers: { get(name: string): string | null },
  hops: number = trustedProxyHops(),
): string | null {
  if (hops === 0) return null;
  const entries = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const picked = entries.length > 0 ? entries[Math.max(0, entries.length - hops)] : undefined;
  const candidate = picked ?? headers.get("x-real-ip")?.trim() ?? "";
  // A key built from arbitrary header text would let one caller fill the limiter's memory.
  return IP_SHAPE.test(candidate) ? candidate : null;
}

/**
 * The address the caller *claims* (the first `x-forwarded-for` entry). Fine for showing a visitor
 * their own IP; never for anything that decides what they may do - that is `clientIpOf`.
 */
export function reportedClientIpOf(headers: { get(name: string): string | null }): string | null {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip") || null;
}
