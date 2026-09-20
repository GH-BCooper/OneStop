// Home: a marketing page for a signed-out visitor (item 13), or a personalized dashboard for
// everyone else (item 14) — a signed-in visitor, or any visitor at all when this instance has no
// accounts configured, since there is nobody such a visitor could ever sign in as.
import { auth, authIsConfigured } from "@/auth";
import { Dashboard } from "@/components/home/Dashboard";
import { Landing } from "@/components/home/Landing";

export default async function HomePage() {
  if (!authIsConfigured()) return <Dashboard name={null} />;
  let session = null;
  try {
    session = await auth();
  } catch (err) {
    // A broken session must never take the home page down - the visitor is simply a guest
    // (mirrors `currentUserId()` in `@/auth`, which this page cannot reuse directly since it also
    // needs the display name for the greeting, not just the id).
    console.error("[home] could not read the session", err);
  }
  if (!session?.user) return <Landing />;
  return <Dashboard name={session.user.name ?? null} />;
}
