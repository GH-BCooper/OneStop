// POST /api/auth/reset - ask for a password reset link (13-auth-database.md).
//
// The answer is identical whether or not the address has an account, so this endpoint cannot be
// used to find out who has one. The link is emailed when a provider is configured, and written to
// the server console otherwise - which is the documented local/dev path (no paid service needed).
import {
  canDeliverMail,
  createPasswordReset,
  getPrisma,
  MAIL_NOT_CONFIGURED_MESSAGE,
  resetEmail,
  selectedTransport,
  sendMail,
} from "@onestop/api";
import { fail, NO_DATABASE_MESSAGE, ok, readJson, str, toErrorResponse } from "@/lib/api-auth";
import { publicBaseUrl } from "@/lib/public-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NEUTRAL_MESSAGE =
  "If that email has an account, a reset link is on its way. The link is valid for one hour.";

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return fail(400, "INVALID_INPUT", "That request could not be read.");
  const email = str(body, "email").trim();
  if (!email) return fail(400, "INVALID_INPUT", "Enter your email address.", "email");

  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  // A server that cannot send email says so, for everyone alike - it says nothing about accounts.
  if (!canDeliverMail()) return fail(503, "MAIL_UNAVAILABLE", MAIL_NOT_CONFIGURED_MESSAGE);

  try {
    const request_ = await createPasswordReset(email, prisma);
    if (request_) {
      const link = `${publicBaseUrl(request)}/auth/reset-password?token=${encodeURIComponent(request_.token)}`;
      const mail = resetEmail(link, request_.expiresAt);
      // Delivery failures are logged, never surfaced: the answer must not differ per address.
      await sendMail({ to: request_.email, ...mail });
    }
    // `transport` only says *how* mail would be sent, never whether this address has an account.
    return ok({ message: NEUTRAL_MESSAGE, transport: selectedTransport() });
  } catch (err) {
    return toErrorResponse(err, "api/auth/reset");
  }
}
