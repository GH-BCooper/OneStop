// Whether this instance has accounts at all — decided purely from environment variables.
//
// It lives apart from `@/auth` on purpose (14-history-favorites.md): `@/auth` pulls in Auth.js and
// the whole `@onestop/api` barrel (sharp, pdfjs, tesseract…), which is a heavy import for a page
// that only wants to know whether to show a "sign in" prompt. `@/auth` re-exports these, so there
// is still one definition.

export function googleIsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

export function authSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.AUTH_SECRET?.trim() || env.NEXTAUTH_SECRET?.trim() || undefined;
}

/** True when signing in is possible at all: it needs both a database and a session secret. */
export function authIsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DATABASE_URL?.trim()) && Boolean(authSecret(env));
}
