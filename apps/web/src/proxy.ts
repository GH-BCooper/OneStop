// Route gate: a signed-out visitor sees only the landing page, the tool catalogue and the sign-in
// pages; a signed-in visitor is kept off the sign-in / sign-up pages (they have no use for them).
//
// Only the presence of a valid session cookie is checked here (no database, no `@/auth` import), so
// this stays cheap on every navigation. Pages and API routes still do their own authorisation.
import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import { authIsConfigured, authSecret } from "@/lib/auth-config";

/** Reachable without an account. `/tools/**` shows the catalogue; running a tool is gated in-page. */
const PUBLIC_PREFIXES = ["/tools", "/auth", "/q", "/offline"];

/** Sign-in / sign-up: pointless (and confusing) once signed in. Password reset stays reachable. */
const GUEST_ONLY = ["/auth/login", "/auth/signup"];

const matches = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export function isPublicPath(path: string): boolean {
  return path === "/" || PUBLIC_PREFIXES.some((p) => matches(path, p));
}

export function isGuestOnlyPath(path: string): boolean {
  return GUEST_ONLY.some((p) => matches(path, p));
}

async function hasSession(req: NextRequest): Promise<boolean> {
  const secret = authSecret();
  // Auth.js names the cookie with a `__Secure-` prefix over HTTPS (and uses the name as the salt);
  // behind a hosting proxy it is not always obvious which one applies, so accept either.
  for (const secureCookie of [true, false]) {
    try {
      if (await getToken({ req, secret, secureCookie, salt: undefined })) return true;
    } catch {
      // An unreadable cookie is the same as no cookie.
    }
  }
  return false;
}

export async function proxy(req: NextRequest) {
  // No accounts configured: nobody could ever sign in, so gating would just lock the app.
  if (!authIsConfigured()) return NextResponse.next();

  const { pathname } = req.nextUrl;
  const publicPath = isPublicPath(pathname);
  const guestOnly = isGuestOnlyPath(pathname);
  if (publicPath && !guestOnly) return NextResponse.next();

  const signedIn = await hasSession(req);

  if (guestOnly && signedIn) {
    const next = req.nextUrl.searchParams.get("next");
    const safe = next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/auth");
    return NextResponse.redirect(new URL(safe ? next : "/", req.url));
  }
  if (!publicPath && !signedIn) {
    const url = new URL("/auth/login", req.url);
    url.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Pages only: API routes authorise themselves, and assets / the service worker must stay open.
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
