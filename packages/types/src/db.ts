// Database-facing shapes (13-auth-database.md; master plan §16).
//
// These mirror `prisma/schema.prisma`, but are written by hand so the shared types package stays
// free of generated code and usable in the browser bundle. The Prisma client is the source of
// truth for queries; this is the source of truth for what crosses an API boundary.

/** A user as the app is allowed to see them - never the password hash. */
export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  /** ISO date (`YYYY-MM-DD`), or null when not set. Never a full timestamp - only the date matters. */
  birthday: string | null;
  createdAt: string;
  /** True when the account can sign in with a password (false for Google-only accounts). */
  hasPassword: boolean;
}

export type ThemePreference = "light" | "dark" | "system";

/** master plan §16. `preferences` holds the small extras that do not deserve a column. */
export interface UserSettings {
  userId: string;
  theme: ThemePreference;
  preferredAI: string | null;
  preferences: Record<string, unknown>;
  updatedAt: string;
}

// `Workflow` lived here as a placeholder until phase 15 gave it a real step shape and a run
// engine; it now lives in `./workflows.ts` alongside the rest of that contract.

/** The signed-in user carried by a session, as the web app sees it. */
export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}
