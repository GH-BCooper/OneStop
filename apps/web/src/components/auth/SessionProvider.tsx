"use client";

// Auth.js session context for the client components that need it (13-auth-database.md).
// It is mounted for everyone: a guest simply has no session, and nothing waits on it.
import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

export function SessionProvider({ children }: { children: ReactNode }) {
  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>;
}
