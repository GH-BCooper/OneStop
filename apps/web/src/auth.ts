// Auth.js (NextAuth v5) configuration (13-auth-database.md).
//
// Two providers, both free:
//   Credentials - email + password, checked against the bcrypt hash in Postgres.
//   Google      - OAuth, registered only when GOOGLE_CLIENT_ID/SECRET are set, so the app runs
//                 (and shows no dead button) without a Google project.
//
// Sessions are JWTs rather than database rows: a signed cookie keeps guest-friendly tools working
// with no database round trip per request, and the `sessions` table stays empty by design.
import { getPrisma, verifyCredentials, type PrismaClient } from "@onestop/api";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter } from "@auth/core/adapters";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
// The three env-only helpers live in `@/lib/auth-config` so a page that only needs the boolean
// does not pull this module - and `@onestop/api` behind it - into its bundle
// (14-history-favorites.md). They are re-exported here, so existing imports keep working.
import { authIsConfigured, authSecret, googleIsConfigured } from "@/lib/auth-config";

export { authIsConfigured, authSecret, googleIsConfigured };

function providers() {
  const list: NextAuthConfig["providers"] = [
    Credentials({
      id: "credentials",
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const email = typeof raw?.email === "string" ? raw.email : "";
        const password = typeof raw?.password === "string" ? raw.password : "";
        const prisma = getPrisma();
        if (!prisma) return null;
        try {
          const user = await verifyCredentials(email, password, prisma);
          return { id: user.id, email: user.email, name: user.name, image: user.avatar };
        } catch {
          // Auth.js turns a null into the generic "sign in failed" path; the form supplies the
          // wording, so nothing here leaks whether the account exists.
          return null;
        }
      },
    }),
  ];
  if (googleIsConfigured()) {
    list.push(
      Google({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }
  return list;
}

export const authConfig: NextAuthConfig = {
  // The adapter persists Google accounts; the credentials flow writes its own rows.
  adapter: (getPrisma() ? PrismaAdapter(getPrisma() as PrismaClient) : undefined) as
    Adapter | undefined,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  secret: authSecret(),
  trustHost: true,
  pages: { signIn: "/auth/login", newUser: "/account", error: "/auth/login" },
  providers: providers(),
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/** The signed-in user id, or null for a guest. Every tool works either way. */
export async function currentUserId(): Promise<string | null> {
  if (!authIsConfigured()) return null;
  try {
    const session = await auth();
    return session?.user?.id ?? null;
  } catch (err) {
    // A broken session must never take a page down - the visitor is simply a guest.
    console.error("[auth] could not read the session", err);
    return null;
  }
}
