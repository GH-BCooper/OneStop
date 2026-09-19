// The auth HTTP surface (13-auth-database.md): signup, password reset and the account routes,
// driven through the real route handlers. The database-backed cases skip themselves when no
// TEST_DATABASE_URL/DATABASE_URL is configured; the guest cases always run.
import {
  createIsolatedTestPrisma,
  disconnectPrisma,
  dropTestSchema,
  testDatabaseReachable,
  resetTestDatabase,
  signUp,
  testDatabaseUrl,
  urlForSchema,
  verifyCredentials,
  type PrismaClient,
} from "@onestop/api";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The routes read DATABASE_URL through getPrisma(). Point it at this file's own schema, so the
// handlers and the assertions below share one isolated copy of the tables.
const SCHEMA = "test_auth_routes";
const url = testDatabaseUrl();
if (url) process.env.DATABASE_URL = urlForSchema(url, SCHEMA);

const session = { userId: null as string | null };
vi.mock("@/auth", () => ({
  currentUserId: async () => session.userId,
  authIsConfigured: () => true,
  googleIsConfigured: () => false,
}));

const { POST: signup } = await import("@/app/api/auth/signup/route");
const { POST: requestReset } = await import("@/app/api/auth/reset/route");
const resetConfirm = await import("@/app/api/auth/reset/confirm/route");
const account = await import("@/app/api/account/route");
const { POST: changePasswordRoute } = await import("@/app/api/account/password/route");

interface Envelope {
  ok?: boolean;
  user?: { id: string; email: string; name: string | null; hasPassword: boolean };
  settings?: { theme: string };
  jobCount?: number;
  message?: string;
  transport?: string;
  valid?: boolean;
  reason?: string;
  error?: { code: string; message: string; field?: string };
}

function post(handler: (r: Request) => Promise<Response>, url: string, body: unknown) {
  return handler(
    new Request(`http://localhost${url}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function json(response: Response): Promise<{ status: number; body: Envelope }> {
  return { status: response.status, body: (await response.json()) as Envelope };
}

// A configured-but-not-running Postgres skips these tests rather than failing them, which is
// the promise `db/testing.ts` makes. Top-level await: the probe has to finish before `describe`.
const describeDb = (await testDatabaseReachable()) ? describe : describe.skip;

describeDb("auth routes (Postgres)", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await createIsolatedTestPrisma(SCHEMA);
    // The reset route logs the link; keep the test output readable.
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  beforeEach(async () => {
    session.userId = null;
    await resetTestDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await disconnectPrisma();
    await dropTestSchema(SCHEMA);
    vi.restoreAllMocks();
  });

  it("creates an account and never echoes the password", async () => {
    const { status, body } = await json(
      await post(signup, "/api/auth/signup", {
        name: "Sam",
        email: "sam@example.com",
        password: "a-good-password",
      }),
    );
    expect(status).toBe(201);
    expect(body.user).toMatchObject({ email: "sam@example.com", hasPassword: true });
    expect(JSON.stringify(body)).not.toContain("a-good-password");
    await expect(
      verifyCredentials("sam@example.com", "a-good-password", prisma),
    ).resolves.toBeTruthy();
  });

  it("answers a duplicate email and a weak password with a field-level message", async () => {
    await post(signup, "/api/auth/signup", {
      name: "Sam",
      email: "sam@example.com",
      password: "a-good-password",
    });
    const duplicate = await json(
      await post(signup, "/api/auth/signup", {
        name: "Sam again",
        email: "SAM@example.com",
        password: "a-good-password",
      }),
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toMatchObject({ code: "EMAIL_TAKEN", field: "email" });

    const weak = await json(
      await post(signup, "/api/auth/signup", {
        name: "Sam",
        email: "other@example.com",
        password: "short",
      }),
    );
    expect(weak.status).toBe(400);
    expect(weak.body.error?.field).toBe("password");
  });

  it("runs the whole reset flow: request, use the link, sign in with the new password", async () => {
    await signUp({ name: "Sam", email: "sam@example.com", password: "the-old-password" }, prisma);

    const requested = await json(
      await post(requestReset, "/api/auth/reset", { email: "sam@example.com" }),
    );
    expect(requested.status).toBe(200);
    expect(requested.body.transport).toBe("console");
    expect(requested.body.message).toMatch(/if that email has an account/i);

    // The mailed link is not in the response - read the token the way the email would carry it.
    const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { usedAt: null } });
    expect(row.tokenHash).toHaveLength(64);

    // An unknown address gets exactly the same answer, and stores nothing.
    const stranger = await json(
      await post(requestReset, "/api/auth/reset", { email: "nobody@example.com" }),
    );
    expect(stranger.body.message).toBe(requested.body.message);
    expect(await prisma.passwordResetToken.count()).toBe(1);
  });

  it("checks a reset token before showing the form, and spends it once", async () => {
    const user = await signUp(
      { name: "Sam", email: "sam@example.com", password: "the-old-password" },
      prisma,
    );
    // Issue a token through the service so the raw value is available to this test.
    const { createPasswordReset } = await import("@onestop/api");
    const issued = await createPasswordReset("sam@example.com", prisma);
    expect(issued?.userId).toBe(user.id);
    const token = issued!.token;

    const check = await json(
      await resetConfirm.GET(
        new Request(`http://localhost/api/auth/reset/confirm?token=${encodeURIComponent(token)}`),
      ),
    );
    expect(check.body.valid).toBe(true);

    const saved = await json(
      await post(resetConfirm.POST, "/api/auth/reset/confirm", {
        token,
        password: "a-brand-new-password",
      }),
    );
    expect(saved.status).toBe(200);
    await expect(
      verifyCredentials("sam@example.com", "the-old-password", prisma),
    ).rejects.toBeTruthy();
    await expect(
      verifyCredentials("sam@example.com", "a-brand-new-password", prisma),
    ).resolves.toBeTruthy();

    const replay = await json(
      await post(resetConfirm.POST, "/api/auth/reset/confirm", {
        token,
        password: "yet-another-password",
      }),
    );
    expect(replay.status).toBe(400);
    expect(replay.body.error?.message).toMatch(/already been used/i);

    const rejected = await json(
      await resetConfirm.GET(new Request("http://localhost/api/auth/reset/confirm?token=nonsense")),
    );
    expect(rejected.body).toMatchObject({ valid: false });
    expect(rejected.body.reason).toMatch(/not valid/i);
  });

  it("keeps the account routes behind a session", async () => {
    const guest = await json(await account.GET());
    expect(guest.status).toBe(401);
    expect(guest.body.error?.code).toBe("AUTH_REQUIRED");
    expect((await json(await account.DELETE())).status).toBe(401);
    expect((await json(await post(changePasswordRoute, "/api/account/password", {}))).status).toBe(
      401,
    );
  });

  it("returns and updates the signed-in profile", async () => {
    const user = await signUp(
      { name: "Sam", email: "sam@example.com", password: "the-old-password" },
      prisma,
    );
    session.userId = user.id;

    const read = await json(await account.GET());
    expect(read.status).toBe(200);
    expect(read.body.user).toMatchObject({ id: user.id, email: "sam@example.com" });
    expect(read.body.settings?.theme).toBe("system");
    expect(read.body.jobCount).toBe(0);

    const patched = await json(
      await account.PATCH(
        new Request("http://localhost/api/account", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Samantha", theme: "dark" }),
        }),
      ),
    );
    expect(patched.body.user?.name).toBe("Samantha");
    expect(patched.body.settings?.theme).toBe("dark");

    const wrongPassword = await json(
      await post(changePasswordRoute, "/api/account/password", {
        currentPassword: "not-the-password",
        newPassword: "a-brand-new-password",
      }),
    );
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body.error?.field).toBe("currentPassword");

    const changed = await json(
      await post(changePasswordRoute, "/api/account/password", {
        currentPassword: "the-old-password",
        newPassword: "a-brand-new-password",
      }),
    );
    expect(changed.status).toBe(200);
    await expect(
      verifyCredentials("sam@example.com", "a-brand-new-password", prisma),
    ).resolves.toBeTruthy();

    expect((await json(await account.DELETE())).status).toBe(200);
    expect(await prisma.user.count()).toBe(0);
  });
});

describe("auth routes without a database", () => {
  let saved: string | undefined;

  beforeEach(async () => {
    session.userId = null;
    saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    await disconnectPrisma();
  });

  afterEach(async () => {
    if (saved) process.env.DATABASE_URL = saved;
    await disconnectPrisma();
  });

  it("says accounts are unavailable instead of crashing", async () => {
    for (const response of [
      await post(signup, "/api/auth/signup", {
        name: "Sam",
        email: "sam@example.com",
        password: "a-good-password",
      }),
      await post(requestReset, "/api/auth/reset", { email: "sam@example.com" }),
      await account.GET(),
    ]) {
      const { status, body } = await json(response);
      expect(status).toBe(503);
      expect(body.error?.code).toBe("DATABASE_UNAVAILABLE");
      expect(body.error?.message).toMatch(/tool still works|tools still work/i);
    }
  });
});
