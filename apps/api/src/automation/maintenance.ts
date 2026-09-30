// Housekeeping for rows that expire but were only ever deleted by accident of use.
//
// A pending sign-up holds a person's email address and a password hash until they type the emailed
// code; if they never do, the row used to sit there for ever (it was only replaced if the same
// address tried again). The same is true of reset tokens, email-change and account-deletion codes,
// and shared-result links after they lapse. None of it is needed once it has expired, and keeping
// people's addresses and hashes longer than the flow that needed them is exactly the sort of quiet
// hoarding the privacy rules (CLAUDE.md §2.5) are meant to prevent.
import type { PrismaClient } from "../db/client.ts";

const DAY_MS = 86_400_000;

export interface PruneResult {
  signupCodes: number;
  resetTokens: number;
  emailChanges: number;
  accountDeletions: number;
  sharedResults: number;
  accessTokens: number;
}

/** Deletes what has expired. Safe to run at any time and as often as you like. */
export async function pruneExpired(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<PruneResult> {
  const day = new Date(now.getTime() - DAY_MS);
  const month = new Date(now.getTime() - 30 * DAY_MS);
  const [signupCodes, resetTokens, emailChanges, accountDeletions, sharedResults, accessTokens] =
    await Promise.all([
      // A code past its expiry can never be entered, and a new request replaces the row anyway.
      prisma.signupOtp.deleteMany({ where: { expiresAt: { lt: now } } }),
      // Used tokens go with the day's grace a support question might want; expired ones likewise.
      prisma.passwordResetToken.deleteMany({
        where: { OR: [{ expiresAt: { lt: day } }, { usedAt: { lt: day } }] },
      }),
      prisma.emailChangeRequest.deleteMany({ where: { expiresAt: { lt: now } } }),
      prisma.accountDeleteOtp.deleteMany({ where: { expiresAt: { lt: now } } }),
      // A lapsed share stays listed for a month so its owner can see it expired, then goes.
      prisma.sharedResult.deleteMany({ where: { expiresAt: { lt: month } } }),
      // Likewise a revoked or expired access token stays visible for a month.
      prisma.accessToken.deleteMany({
        where: { OR: [{ revokedAt: { lt: month } }, { expiresAt: { lt: month } }] },
      }),
    ]);
  return {
    signupCodes: signupCodes.count,
    resetTokens: resetTokens.count,
    emailChanges: emailChanges.count,
    accountDeletions: accountDeletions.count,
    sharedResults: sharedResults.count,
    accessTokens: accessTokens.count,
  };
}
