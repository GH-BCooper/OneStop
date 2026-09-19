// Google OAuth coverage (13-auth-database.md, audited in 19-testing.md).
//
// Phase 13's suites cover email/password sign-in, sign-up and password reset thoroughly, and the
// login form's test covers the Google *button* appearing only when it is configured. What was
// never covered is the half that only breaks in production: whether the Auth.js Google provider
// is registered from the environment correctly, and whether the Prisma adapter can actually
// persist an OAuth account against *our* schema.
//
// No Google project and no network are needed for either. The adapter half needs a database and
// skips itself without one, like every other database suite here.
import type { Adapter } from "@auth/core/adapters";
// Imported statically, and before any `vi.resetModules()`, so the adapter under test comes from
// the same module graph as the test's Prisma client.
import { onestopAdapter } from "@/auth";
import {
  createIsolatedTestPrisma,
  dropTestSchema,
  testDatabaseReachable,
  type PrismaClient,
} from "@onestop/api";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const GOOGLE_ENV = { GOOGLE_CLIENT_ID: "test-client-id", GOOGLE_CLIENT_SECRET: "test-secret" };

/** Loads `@/auth` fresh, with the given environment, since providers are built at import time. */
async function loadAuth(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) vi.stubEnv(key, "");
    else vi.stubEnv(key, value);
  }
  return import("@/auth");
}

// The stubs stay in place for the body of each test: `googleIsConfigured()` reads the environment
// when it is called, not when the module loaded.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the Google provider is registered from the environment", () => {
  it("is absent when no Google project is configured", async () => {
    const { authConfig } = await loadAuth({
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
    });
    expect(authConfig.providers.map((p) => ("id" in p ? p.id : ""))).toEqual(["credentials"]);
  });

  it("is absent when only half of the credentials are set", async () => {
    const { authConfig } = await loadAuth({
      GOOGLE_CLIENT_ID: GOOGLE_ENV.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: undefined,
    });
    expect(authConfig.providers.map((p) => ("id" in p ? p.id : ""))).toEqual(["credentials"]);
  });

  it("is registered, as an OAuth provider, when both are set", async () => {
    const { authConfig, googleIsConfigured } = await loadAuth(GOOGLE_ENV);
    expect(googleIsConfigured()).toBe(true);
    const google = authConfig.providers.find((p) => "id" in p && p.id === "google");
    expect(google, "Google should be registered when the env is complete").toBeTruthy();
    const provider = google as { type?: string; options?: Record<string, unknown> };
    expect(provider.type).toBe("oidc");
    // Same email, same person: a visitor who signed up with a password can still use the Google
    // button. Auth.js calls this "dangerous" because it trusts the provider's verified email,
    // which is exactly what Google gives us.
    expect(provider.options?.allowDangerousEmailAccountLinking).toBe(true);
  });

  it("keeps sessions as signed JWTs and puts the user id on them", async () => {
    const { authConfig } = await loadAuth(GOOGLE_ENV);
    expect(authConfig.session?.strategy).toBe("jwt");
    const token = await authConfig.callbacks!.jwt!({
      token: {},
      user: { id: "user-1", email: "a@example.com" },
    } as never);
    expect((token as { sub?: string }).sub).toBe("user-1");
    const session = await authConfig.callbacks!.session!({
      session: { user: { email: "a@example.com" } },
      token: { sub: "user-1" },
    } as never);
    expect((session as { user?: { id?: string } }).user?.id).toBe("user-1");
  });
});

const SCHEMA = "test_oauth";
const describeDb = (await testDatabaseReachable()) ? describe : describe.skip;

describeDb("the Prisma adapter persists a Google account against our schema", () => {
  let prisma: PrismaClient;
  let adapter: Adapter;

  beforeAll(async () => {
    prisma = await createIsolatedTestPrisma(SCHEMA);
    // The app's own adapter, not the bare Prisma one: the `image`/`avatar` translation is part of
    // what has to work.
    adapter = onestopAdapter(prisma);
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await dropTestSchema(SCHEMA);
  });

  it("creates the user and links the OAuth account, then finds the user by it", async () => {
    const profile = {
      id: "ignored-by-prisma",
      email: "oauth-user@example.com",
      emailVerified: new Date(),
      name: "OAuth User",
      image: "https://example.com/avatar.png",
    };

    const user = await adapter.createUser!(profile as never);
    expect(user.email).toBe(profile.email);
    // Auth.js reads the picture as `image`; the column is `avatar`.
    expect(user.image).toBe(profile.image);
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.avatar).toBe(profile.image);

    await adapter.linkAccount!({
      userId: user.id,
      type: "oidc",
      provider: "google",
      providerAccountId: "google-123",
      access_token: "not-a-real-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      scope: "openid email profile",
      id_token: "not-a-real-id-token",
    } as never);

    // This is the lookup every subsequent Google sign-in does.
    const found = await adapter.getUserByAccount!({
      provider: "google",
      providerAccountId: "google-123",
    });
    expect(found?.id).toBe(user.id);
    expect(found?.email).toBe(profile.email);

    // And the row really is in our Account table, owned by that user.
    const accounts = await prisma.account.findMany({ where: { userId: user.id } });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.provider).toBe("google");
    // No password was ever set for an OAuth-only account.
    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored?.passwordHash ?? null).toBeNull();
  }, 60_000);

  it("finds an existing account holder by email, which is what account linking relies on", async () => {
    const existing = await prisma.user.create({
      data: { email: "linked@example.com", name: "Already Here", passwordHash: "$2b$10$notreal" },
    });
    const found = await adapter.getUserByEmail!("linked@example.com");
    expect(found?.id).toBe(existing.id);
  }, 60_000);
});
