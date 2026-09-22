"use client";

// Auth.js session context for the client components that need it (13-auth-database.md).
// It is mounted for everyone: a guest simply has no session, and nothing waits on it.
import { useSession, SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import { useEffect, type ReactNode } from "react";
import { setAiKeyScope } from "@/lib/preferences";

/**
 * Keeps the browser's saved AI keys namespaced to whichever account is signed in, so one person's
 * keys never show up prefilled for the next person who signs into the same browser.
 */
function AiKeyScopeSync() {
  const { data: session } = useSession();
  useEffect(() => {
    setAiKeyScope(session?.user?.id ?? null);
  }, [session?.user?.id]);
  return null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  return (
    <NextAuthSessionProvider>
      <AiKeyScopeSync />
      {children}
    </NextAuthSessionProvider>
  );
}
