// POST /api/account/delete — request the emailed code needed to actually delete the account
// (account settings). One click must never be enough to destroy an account (CLAUDE.md §5 privacy),
// so this only sends the proof-of-mailbox code; `/api/account/delete/confirm` does the deletion.
import {
  accountDeleteEmail,
  ACCOUNT_DELETE_CODE_TTL_MINUTES,
  canDeliverMail,
  discardAccountDeletion,
  getPrisma,
  MAIL_NOT_CONFIGURED_MESSAGE,
  requestAccountDeletion,
  sendMail,
} from "@onestop/api";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", "Sign in to delete your account.");
  if (!canDeliverMail()) return fail(503, "MAIL_UNAVAILABLE", MAIL_NOT_CONFIGURED_MESSAGE);

  try {
    const pending = await requestAccountDeletion(userId, prisma);
    const result = await sendMail({
      to: pending.email,
      ...accountDeleteEmail(pending.code, pending.expiresAt),
    });
    if (!result.delivered) {
      await discardAccountDeletion(userId, prisma);
      return fail(
        502,
        "MAIL_FAILED",
        "We couldn't send the confirmation email. Try again in a moment.",
      );
    }
    return ok({
      expiresInMinutes: ACCOUNT_DELETE_CODE_TTL_MINUTES,
      message: `We sent a 6-digit code to ${pending.email}.`,
    });
  } catch (err) {
    return toErrorResponse(err, "api/account/delete");
  }
}
