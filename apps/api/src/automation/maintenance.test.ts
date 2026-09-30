// Expiry housekeeping (see maintenance.ts): an abandoned sign-up must not keep a person's email and
// password hash for ever, and a live code or a fresh share must never be swept by mistake.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createIsolatedTestPrisma,
  dropTestSchema,
  testDatabaseReachable,
  type PrismaClient,
} from "../db/testing.ts";
import { pruneExpired } from "./maintenance.ts";

const describeDb = (await testDatabaseReachable()) ? describe : describe.skip;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describeDb("pruneExpired (database)", () => {
  let prisma: PrismaClient;
  const schema = "test_maintenance";
  beforeAll(async () => {
    prisma = await createIsolatedTestPrisma(schema);
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await dropTestSchema(schema);
  });

  it("removes what has expired and leaves what is still live", async () => {
    const now = new Date("2026-06-15T12:00:00Z");
    const at = (ms: number) => new Date(now.getTime() + ms);
    const user = await prisma.user.create({ data: { email: "keep@example.com", name: "Keep" } });
    const signup = (email: string, expiresAt: Date) =>
      prisma.signupOtp.create({
        data: { email, name: "N", passwordHash: "x", codeHash: "y", expiresAt },
      });
    await signup("gone@example.com", at(-HOUR));
    await signup("live@example.com", at(HOUR));

    const reset = (hash: string, expiresAt: Date, usedAt?: Date) =>
      prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hash, expiresAt, ...(usedAt ? { usedAt } : {}) },
      });
    await reset("expired-long-ago", at(-2 * DAY));
    await reset("expired-just-now", at(-HOUR)); // inside the one-day grace
    await reset("live", at(HOUR));
    await reset("used-long-ago", at(HOUR), at(-2 * DAY));

    const share = (slug: string, expiresAt: Date) =>
      prisma.sharedResult.create({
        data: { slug, userId: user.id, jobId: "job", expiresAt },
      });
    await share("lapsed-long-ago", at(-40 * DAY));
    await share("lapsed-recently", at(-2 * DAY)); // still listed, so its owner can see it expired
    await share("fresh", at(2 * DAY));

    const result = await pruneExpired(prisma, now);
    expect(result).toMatchObject({ signupCodes: 1, resetTokens: 2, sharedResults: 1 });

    expect((await prisma.signupOtp.findMany()).map((r) => r.email)).toEqual(["live@example.com"]);
    expect((await prisma.passwordResetToken.findMany()).map((r) => r.tokenHash).sort()).toEqual([
      "expired-just-now",
      "live",
    ]);
    expect((await prisma.sharedResult.findMany()).map((r) => r.slug).sort()).toEqual([
      "fresh",
      "lapsed-recently",
    ]);
  });

  it("is harmless on an empty database and when run twice", async () => {
    await prisma.signupOtp.deleteMany({});
    const first = await pruneExpired(prisma);
    const second = await pruneExpired(prisma);
    expect(second).toEqual({ ...first, signupCodes: 0, resetTokens: 0, sharedResults: 0 });
  });
});
