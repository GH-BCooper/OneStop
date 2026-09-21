// Auth.js (NextAuth v5) configuration (13-auth-database.md).
//
// Two providers, both free:
//   Credentials - email + password, checked against the bcrypt hash in Postgres.
//   Google      - OAuth, registered only when GOOGLE_CLIENT_ID/SECRET are set, so the app runs
//                 (and shows no dead button) without a Google project.
//
// Sessions are JWTs rather than database rows: a signed cookie keeps guest-friendly tools working
// with no database round trip per request, and the `sessions` table stays empty by design.
import { findUserById, getPrisma, verifyCredentials, type PrismaClient } from "@onestop/api";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter } from "@auth/core/adapters";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
// The three env-only helpers live in `@/lib/auth-config` so a page that only needs the boolean
// does not pull this module - and `@onestop/api` behind it - into its bundle
// (14-history-favorites.md). They are re-exported here, so existing imports keep working.
import { authIsConfigured, authSecret, googleIsConfigured } from "@/lib/auth-config";
import { applyPublicAuthUrl } from "@/lib/public-url";

// Behind a hosting proxy Auth.js would otherwise build its redirects from the internal
// `localhost:<port>` address; point it at the real public one when there is one.
applyPublicAuthUrl();

export { authIsConfigured, authSecret, googleIsConfigured };

/**
 * Where a signed-in user's picture is served from a session's point of view.
 *
 * A credentials-account avatar is a `data:image/webp;base64,...` string (see `avatar.ts`) - often
 * tens of KB. Auth.js copies `image` straight into the JWT's `picture` claim, and that claim rides
 * along as a cookie on *every* request; a data URL in there is exactly how a session cookie grows
 * past a server's header-size limit and every page starts answering HTTP 431 (a real incident this
 * fixes). A real http(s) URL (Google's profile photo) is a few dozen bytes and stays as-is; a data
 * URL is swapped for the small proxy path below, which `GET /api/account/avatar` resolves to the
 * actual bytes without ever putting them in a cookie.
 */
const AVATAR_PROXY_PATH = "/api/account/avatar";

export function avatarRef(avatar: string | null | undefined): string | null {
  if (!avatar) return null;
  return avatar.startsWith("data:") ? AVATAR_PROXY_PATH : avatar;
}

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
          return { id: user.id, email: user.email, name: user.name, image: avatarRef(user.avatar) };
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

/**
 * The Prisma adapter, with one field renamed.
 *
 * Auth.js calls a user's picture `image`; master plan §16 calls it `avatar`, and that is the
 * column OneStop has. `PrismaAdapter` passes the OAuth profile straight to `prisma.user.create`,
 * so without this a first-ever Google sign-in fails with "Unknown argument `image`" - the app
 * would look fine right up until someone actually used the button (found in 19-testing.md).
 *
 * Nothing else is changed: the adapter still owns the rows, this only translates one name in
 * each direction.
 */
export function onestopAdapter(prisma: PrismaClient): Adapter {
  const base = PrismaAdapter(prisma);
  type WithImage = { image?: string | null; avatar?: string | null } | null;
  const out = <T extends WithImage>(user: T): T =>
    user ? ({ ...user, image: avatarRef(user.image ?? user.avatar ?? null) } as T) : user;
  const inward = <T extends WithImage>(user: T): T => {
    if (!user) return user;
    const { image, ...rest } = user;
    return { ...rest, avatar: image ?? user.avatar ?? null } as unknown as T;
  };
  return {
    ...base,
    createUser: async (user) => out(await base.createUser!(inward(user))),
    getUser: async (id) => out(await base.getUser!(id)),
    getUserByEmail: async (email) => out(await base.getUserByEmail!(email)),
    getUserByAccount: async (account) => out(await base.getUserByAccount!(account)),
    updateUser: async (user) => out(await base.updateUser!(inward(user))),
  } as Adapter;
}

export const authConfig: NextAuthConfig = {
  // The adapter persists Google accounts; the credentials flow writes its own rows.
  adapter: getPrisma() ? onestopAdapter(getPrisma() as PrismaClient) : undefined,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  secret: authSecret(),
  trustHost: true,
  pages: { signIn: "/auth/login", newUser: "/", error: "/auth/login" },
  providers: providers(),
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user?.id) token.sub = user.id;
      // The profile page calls `useSession().update()` right after a name or avatar change, so
      // the header reflects it without waiting for a fresh sign-in. What the client sends is only
      // a nudge: the new values are read back from the database, the one source of truth.
      if (trigger === "update" && token.sub) {
        const prisma = getPrisma();
        const fresh = prisma ? await findUserById(token.sub, prisma).catch(() => null) : null;
        if (fresh) {
          token.name = fresh.name;
          token.picture = avatarRef(fresh.avatar);
        } else if (session && typeof session === "object" && "image" in session) {
          token.picture = avatarRef((session as { image?: string | null }).image ?? null);
        }
      }
      // Belt and braces: whatever produced this claim, a data URL never belongs in a cookie.
      if (typeof token.picture === "string") token.picture = avatarRef(token.picture);
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
