// The public address of this instance, for the places that must put an absolute URL somewhere a
// person will open it later (the link in a reset email, Auth.js's own redirects).
//
// It is built from configuration, never from the request's Host header: a forged Host on a
// "forgot password" request would otherwise point the emailed link at an attacker's site. The
// request is only a last resort, for a local run where nothing is configured at all.
//
// A hosted platform's own process is reached as `http://localhost:<port>` from behind its proxy, so
// a `localhost` value in APP_URL/NEXTAUTH_URL (copied from a local `.env`) is treated as "not set"
// whenever the platform tells us the real address (Render sets RENDER_EXTERNAL_URL itself).

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"].includes(host);
  } catch {
    return true;
  }
}

export function publicBaseUrl(request?: Request, env: NodeJS.ProcessEnv = process.env): string {
  const configured = [env.APP_URL, env.NEXTAUTH_URL, env.AUTH_URL]
    .map(clean)
    .filter((u): u is string => u !== null);
  const real = configured.find((u) => !isLocalUrl(u));
  if (real) return real;
  const platform = clean(env.RENDER_EXTERNAL_URL);
  if (platform) return platform;
  if (configured[0]) return configured[0];
  if (request) {
    try {
      return new URL(request.url).origin;
    } catch {
      // fall through
    }
  }
  return "http://localhost:3000";
}

/**
 * Points Auth.js at the real public address when the configured one is missing or is `localhost`
 * on a host that has a real one. Without this Auth.js builds its redirects from the internal
 * address (sign-out landing on `localhost:10000`, OAuth callbacks that no provider accepts).
 */
export function applyPublicAuthUrl(env: NodeJS.ProcessEnv = process.env): void {
  const current = clean(env.AUTH_URL) ?? clean(env.NEXTAUTH_URL);
  const best = publicBaseUrl(undefined, env);
  if ((!current || isLocalUrl(current)) && !isLocalUrl(best)) env.AUTH_URL = best;
}
