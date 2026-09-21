// Signing out, and landing on the landing page.
//
// Auth.js's own `redirectTo` is built on the server from whatever address it believes it has, and
// behind a hosting proxy that can be the internal `localhost:<port>` one. So the session is cleared
// without a redirect and the browser itself is sent to a relative path, which is always this site.
//
// One more trap: a session read that was already on its way when the person clicked "Sign out"
// answers with a fresh copy of the old cookie, and if it lands after the sign-out it quietly signs
// them back in. So after each sign-out the session is asked for once more, and the sign-out is
// repeated until it really is gone.
import { signOut } from "next-auth/react";

async function stillSignedIn(): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as { user?: unknown } | null;
    return Boolean(body?.user);
  } catch {
    return false;
  }
}

export async function signOutToLanding(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await signOut({ redirect: false });
    } catch (err) {
      console.error("[auth] sign-out request failed", err);
    }
    if (!(await stillSignedIn())) break;
  }
  // A full navigation, on purpose: the landing page must be rendered by the server for a visitor
  // whose session cookie is gone, and no client-side cache may carry the signed-in page over.
  window.location.assign(new URL("/", window.location.origin).href);
}
