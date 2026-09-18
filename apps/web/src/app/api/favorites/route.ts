// Favourite tools for the signed-in user (14-history-favorites.md).
//
//   GET  /api/favorites - the starred registry ids, most recent first
//   POST /api/favorites - { toolId, on? } toggles (or sets) one star and returns the new list
//
// A guest keeps stars in localStorage and never calls this route.
import {
  getPrisma,
  listFavorites,
  setFavorite,
  toggleFavorite,
  TooManyFavoritesError,
  UnknownFavoriteToolError,
} from "@onestop/api";
import { currentUserId } from "@/auth";
import { fail, NO_DATABASE_MESSAGE, ok, readJson, toErrorResponse } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGN_IN_REQUIRED = "Sign in to keep your favourite tools across devices.";

export async function GET(): Promise<Response> {
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    return ok({ favorites: await listFavorites(userId, prisma) });
  } catch (err) {
    return toErrorResponse(err, "api/favorites");
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return fail(400, "INVALID_INPUT", "That request could not be read.");
  const toolId = typeof body.toolId === "string" ? body.toolId : "";
  if (!toolId) return fail(400, "INVALID_INPUT", "No tool was specified.");
  const prisma = getPrisma();
  if (!prisma) return fail(503, "DATABASE_UNAVAILABLE", NO_DATABASE_MESSAGE);
  const userId = await currentUserId();
  if (!userId) return fail(401, "AUTH_REQUIRED", SIGN_IN_REQUIRED);
  try {
    // `on` makes the call idempotent for a client that knows the state it wants; without it the
    // star simply flips.
    if (typeof body.on === "boolean") {
      const favorites = await setFavorite(userId, toolId, body.on, prisma);
      return ok({ favorites, on: body.on });
    }
    const { favorites, on } = await toggleFavorite(userId, toolId, prisma);
    return ok({ favorites, on });
  } catch (err) {
    if (err instanceof UnknownFavoriteToolError) return fail(404, err.code, err.message);
    if (err instanceof TooManyFavoritesError) return fail(409, err.code, err.message);
    return toErrorResponse(err, "api/favorites");
  }
}
