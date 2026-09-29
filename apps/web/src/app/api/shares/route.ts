// Shareable read-only result links (21-roadmap-expansion.md, roadmap §2).
//
//   GET  /api/shares - this user's links, newest first
//   POST /api/shares - { jobId, title?, hours?, passphrase? } creates one
//
// A link never outlives the temp files it points at: `createShare` clamps its own expiry to the
// retention window, so it cannot promise a file that has already been cleaned up.
import { ShareError, createShare, getPrisma, listShares, loadFileCoreConfig } from "@onestop/api";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, readJson, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGN_IN_REQUIRED = "Sign in to share a result.";

export async function GET(): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    return ok({ shares: await listShares(userId, prisma) });
  } catch (err) {
    return toErrorResponse(err, "api/shares");
  }
}

export async function POST(request: Request): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  const body = await readJson(request);
  if (!body) return fail(400, "INVALID_INPUT", "That request could not be read.");
  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  if (!jobId) return fail(400, "INVALID_INPUT", "No result was specified.");
  try {
    const share = await createShare(
      userId,
      {
        jobId,
        title: typeof body.title === "string" ? body.title : null,
        ...(typeof body.hours === "number" ? { hours: body.hours } : {}),
        passphrase: typeof body.passphrase === "string" ? body.passphrase : null,
        // The ceiling: whenever this job's files are due to be deleted.
        filesExpireAt: new Date(Date.now() + loadFileCoreConfig().ttlMs),
      },
      prisma,
    );
    return ok({ share }, 201);
  } catch (err) {
    if (err instanceof ShareError) return fail(err.status, "INVALID_INPUT", err.message);
    return toErrorResponse(err, "api/shares");
  }
}
