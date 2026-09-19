// End-to-end auth behaviour against a real Postgres (13-auth-database.md).
// Skipped when no TEST_DATABASE_URL/DATABASE_URL is set, so `npm test` still passes with no DB.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createIsolatedTestPrisma,
  dropTestSchema,
  testDatabaseReachable,
  resetTestDatabase,
  type PrismaClient,
} from "../db/testing.ts";
import { isBcryptHash } from "./passwords.ts";
import {
  checkResetToken,
  createPasswordReset,
  purgeExpiredResetTokens,
  resetPasswordWithToken,
} from "./reset-tokens.ts";
import { getUserSettings, updateUserSettings } from "./settings.ts";
import {
  AuthError,
  changePassword,
  deleteAccount,
  findUserByEmail,
  signUp,
  updateProfile,
  verifyCredentials,
} from "./users.ts";

// A configured-but-not-running Postgres skips these tests rather than failing them, which is
// the promise `db/testing.ts` makes. Top-level await: the probe has to finish before `describe`.
const describeDb = (await testDatabaseReachable()) ? describe : describe.skip;

const SCHEMA = "test_accounts";

describeDb("accounts (Postgres)", () => {
  let prisma: PrismaClient;

  const password = "a-very-good-password";

  beforeAll(async () => {
    prisma = await createIsolatedTestPrisma(SCHEMA);
  });
  beforeEach(() => resetTestDatabase(prisma));
  afterAll(async () => {
    await prisma.$disconnect();
    await dropTestSchema(SCHEMA);
  });

  it("creates a user with a hashed password and never returns the hash", async () => {
    const user = await signUp(
      { name: "Ada Lovelace", email: "Ada@Example.com ", password },
      prisma,
    );
    expect(user).toMatchObject({
      email: "ada@example.com",
      name: "Ada Lovelace",
      hasPassword: true,
    });
    expect(JSON.stringify(user)).not.toContain(password);

    // Inspect the row directly: the stored value must be a bcrypt hash, not the password.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash).not.toBe(password);
    expect(isBcryptHash(row.passwordHash ?? "")).toBe(true);

    // Signing up creates the settings row from master plan section 16.
    const settings = await getUserSettings(user.id, prisma);
    expect(settings).toMatchObject({ userId: user.id, theme: "system", preferredAI: null });
  });

  it("rejects a duplicate email, whatever its casing", async () => {
    await signUp({ name: "Ada", email: "ada@example.com", password }, prisma);
    await expect(
      signUp({ name: "Someone else", email: "ADA@example.com", password }, prisma),
    ).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
    expect(await prisma.user.count()).toBe(1);
  });

  it("validates input before touching the database", async () => {
    await expect(signUp({ name: "", email: "a@b.co", password }, prisma)).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(signUp({ name: "A", email: "nope", password }, prisma)).rejects.toMatchObject({
      field: "email",
    });
    await expect(
      signUp({ name: "A", email: "a@b.co", password: "short" }, prisma),
    ).rejects.toMatchObject({ field: "password" });
    expect(await prisma.user.count()).toBe(0);
  });

  it("signs in with the right password and fails the same way for every wrong attempt", async () => {
    const user = await signUp({ name: "Ada", email: "ada@example.com", password }, prisma);
    await expect(verifyCredentials("ada@example.com", password, prisma)).resolves.toMatchObject({
      id: user.id,
    });
    // Casing of the email does not matter; the password's does.
    await expect(verifyCredentials("ADA@EXAMPLE.COM", password, prisma)).resolves.toMatchObject({
      id: user.id,
    });
    const wrongPassword = await verifyCredentials(
      "ada@example.com",
      "nope-nope-nope",
      prisma,
    ).catch((e: AuthError) => e);
    const unknownUser = await verifyCredentials("nobody@example.com", password, prisma).catch(
      (e: AuthError) => e,
    );
    expect(wrongPassword).toBeInstanceOf(AuthError);
    expect((wrongPassword as AuthError).message).toBe((unknownUser as AuthError).message);
    expect((wrongPassword as AuthError).message).toMatch(/email or password is incorrect/i);
  });

  it("updates the profile and changes the password", async () => {
    const user = await signUp({ name: "Ada", email: "ada@example.com", password }, prisma);
    expect(await updateProfile(user.id, { name: "  Ada L.  " }, prisma)).toMatchObject({
      name: "Ada L.",
    });
    await expect(
      changePassword(user.id, "wrong-password", "another-good-password", prisma),
    ).rejects.toMatchObject({ field: "currentPassword" });
    await changePassword(user.id, password, "another-good-password", prisma);
    await expect(verifyCredentials("ada@example.com", password, prisma)).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(
      verifyCredentials("ada@example.com", "another-good-password", prisma),
    ).resolves.toMatchObject({ id: user.id });
  });

  it("stores settings and deletes the account on request", async () => {
    const user = await signUp({ name: "Ada", email: "ada@example.com", password }, prisma);
    await updateUserSettings(user.id, { theme: "dark", preferredAI: "ollama" }, prisma);
    expect(await getUserSettings(user.id, prisma)).toMatchObject({
      theme: "dark",
      preferredAI: "ollama",
    });
    // An unknown theme is ignored rather than stored.
    await updateUserSettings(user.id, { theme: "neon" as never }, prisma);
    expect((await getUserSettings(user.id, prisma)).theme).toBe("dark");

    await deleteAccount(user.id, prisma);
    expect(await findUserByEmail("ada@example.com", prisma)).toBeNull();
    expect(await prisma.userSettings.count()).toBe(0);
  });
});

const RESET_SCHEMA = "test_password_reset";

describeDb("password reset (Postgres)", () => {
  let prisma: PrismaClient;

  const password = "the-original-password";

  beforeAll(async () => {
    prisma = await createIsolatedTestPrisma(RESET_SCHEMA);
  });
  beforeEach(() => resetTestDatabase(prisma));
  afterAll(async () => {
    await prisma.$disconnect();
    await dropTestSchema(RESET_SCHEMA);
  });

  async function account() {
    return signUp({ name: "Ada", email: "ada@example.com", password }, prisma);
  }

  async function issueToken(options?: { ttlMinutes?: number }) {
    const request = await createPasswordReset("ada@example.com", prisma, options ?? {});
    if (!request) throw new Error("expected a reset request");
    return request;
  }

  it("issues a token, resets the password, and retires the old one", async () => {
    const user = await account();
    const request = await issueToken();
    expect(request.userId).toBe(user.id);

    // Only the hash is stored - the mailed token never lands in the database.
    const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.tokenHash).not.toBe(request.token);
    expect(row.tokenHash).toHaveLength(64);

    expect(await checkResetToken(request.token, prisma)).toMatchObject({
      valid: true,
      userId: user.id,
    });
    await resetPasswordWithToken(request.token, "a-brand-new-password", prisma);

    await expect(verifyCredentials("ada@example.com", password, prisma)).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(
      verifyCredentials("ada@example.com", "a-brand-new-password", prisma),
    ).resolves.toMatchObject({ id: user.id });
  });

  it("only lets a token be spent once", async () => {
    await account();
    const { token } = await issueToken();
    await resetPasswordWithToken(token, "first-new-password", prisma);
    await expect(
      resetPasswordWithToken(token, "second-new-password", prisma),
    ).rejects.toMatchObject({ message: /already been used/i });
    expect(await checkResetToken(token, prisma)).toMatchObject({ valid: false, problem: "USED" });
  });

  it("rejects an expired token", async () => {
    await account();
    const { token } = await issueToken({ ttlMinutes: 60 });
    const later = Date.now() + 61 * 60_000;
    expect(await checkResetToken(token, prisma, { now: () => later })).toMatchObject({
      valid: false,
      problem: "EXPIRED",
    });
    await expect(
      resetPasswordWithToken(token, "a-brand-new-password", prisma, { now: () => later }),
    ).rejects.toMatchObject({ message: /expired/i });
    // The password is unchanged.
    await expect(verifyCredentials("ada@example.com", password, prisma)).resolves.toBeTruthy();
  });

  it("rejects an unknown or tampered token", async () => {
    await account();
    const { token } = await issueToken();
    expect(await checkResetToken(`${token}x`, prisma)).toMatchObject({ problem: "UNKNOWN" });
    expect(await checkResetToken("", prisma)).toMatchObject({ problem: "UNKNOWN" });
    await expect(
      resetPasswordWithToken("nonsense", "a-good-password", prisma),
    ).rejects.toMatchObject({ message: /not valid/i });
  });

  it("invalidates earlier links when a new one is requested", async () => {
    await account();
    const first = await issueToken();
    const second = await issueToken();
    expect(await checkResetToken(first.token, prisma)).toMatchObject({ problem: "USED" });
    expect(await checkResetToken(second.token, prisma)).toMatchObject({ valid: true });
  });

  it("says nothing about whether an email has an account", async () => {
    expect(await createPasswordReset("nobody@example.com", prisma)).toBeNull();
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  it("refuses a weak new password before spending the token", async () => {
    await account();
    const { token } = await issueToken();
    await expect(resetPasswordWithToken(token, "short", prisma)).rejects.toMatchObject({
      field: "password",
    });
    expect(await checkResetToken(token, prisma)).toMatchObject({ valid: true });
  });

  it("purges spent and expired tokens", async () => {
    const user = await account();
    const { token } = await issueToken();
    await resetPasswordWithToken(token, "a-brand-new-password", prisma);
    await issueToken({ ttlMinutes: -1 });
    expect(await purgeExpiredResetTokens(prisma)).toBeGreaterThanOrEqual(2);
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(0);
  });
});
