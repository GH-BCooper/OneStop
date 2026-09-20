// The signed-in user's profile picture (13-auth-database.md; drag-and-drop avatar).
//
//   GET    /api/account/avatar - the image bytes (what the session's small proxy path resolves to)
//   POST   /api/account/avatar - replace it (multipart, one image file)
//   DELETE /api/account/avatar - remove it
import { findUserById, getPrisma, processAvatarUpload, updateProfile } from "@onestop/api";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGN_IN_REQUIRED = "Sign in to see your account.";

/**
 * Resolves the session's small `/api/account/avatar` reference (see `avatarRef` in `@/auth`) back
 * to real bytes, so the actual `data:image/webp;base64,...` never has to ride along as a cookie.
 */
export async function GET(): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return new Response(null, { status: 404 });
  const userId = await currentUserId();
  if (!userId) return new Response(null, { status: 401 });
  const user = await findUserById(userId, prisma);
  const avatar = user?.avatar;
  if (!avatar) return new Response(null, { status: 404 });
  if (/^https?:\/\//i.test(avatar)) return Response.redirect(avatar, 302);
  const match = /^data:([^;,]+);base64,(.+)$/.exec(avatar);
  if (!match) return new Response(null, { status: 404 });
  const [, mimeType, base64] = match;
  return new Response(Buffer.from(base64!, "base64"), {
    headers: {
      "content-type": mimeType!,
      "cache-control": "private, max-age=300",
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "UNSUPPORTED_INPUT", "The upload could not be read. Please try again.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return fail(400, "UNSUPPORTED_INPUT", "Choose an image file.", "avatar");
  }

  try {
    const avatar = await processAvatarUpload(new Uint8Array(await file.arrayBuffer()));
    const user = await updateProfile(userId, { avatar }, prisma);
    return ok({ user });
  } catch (err) {
    return toErrorResponse(err, "api/account/avatar");
  }
}

export async function DELETE(): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    const user = await updateProfile(userId, { avatar: null }, prisma);
    return ok({ user });
  } catch (err) {
    return toErrorResponse(err, "api/account/avatar");
  }
}
