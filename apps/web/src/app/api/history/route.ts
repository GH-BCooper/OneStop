// The signed-in user's job history (14-history-favorites.md).
//
//   GET    /api/history - one filtered, paginated page of past runs
//   DELETE /api/history - clear the whole history
//
// A guest never reaches this route: their history lives in IndexedDB on the device and the page
// reads it without a network call at all. That is deliberate (build file, Scope - In).
import { clearHistory, getPrisma, listHistory } from "@onestop/api";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, toErrorResponse } from "@/lib/api-auth";
import { parseHistoryParams } from "@/lib/history-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGN_IN_REQUIRED = "Sign in to see the history saved to your account.";

export async function GET(request: Request): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    const { category: _category, ...filter } = parseHistoryParams(
      new URL(request.url).searchParams,
    );
    const result = await listHistory(userId, filter, prisma);
    return ok({ ...result });
  } catch (err) {
    return toErrorResponse(err, "api/history");
  }
}

export async function DELETE(): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    const removed = await clearHistory(userId, prisma);
    return ok({ removed });
  } catch (err) {
    return toErrorResponse(err, "api/history");
  }
}
