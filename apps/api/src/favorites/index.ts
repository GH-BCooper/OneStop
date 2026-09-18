// Favourite tools for signed-in users (14-history-favorites.md).
//
// A favourite is nothing but "this user starred this registry id". The registry stays the single
// source of truth for what a tool is (CLAUDE.md §2.7), so an id that is not in it is rejected
// rather than stored - that keeps a stale star from ever pointing at a tool that no longer exists.
import { getTool } from "@onestop/tool-registry";
import { requirePrisma, type PrismaClient } from "../db/client.ts";

/** Ceiling on how many tools one account can star. Generous; the registry is ~200 tools. */
export const MAX_FAVORITES = 300;

export class UnknownFavoriteToolError extends Error {
  readonly code = "UNSUPPORTED_INPUT";
  constructor(readonly toolId: string) {
    super("That tool does not exist.");
    this.name = "UnknownFavoriteToolError";
  }
}

export class TooManyFavoritesError extends Error {
  readonly code = "UNSUPPORTED_INPUT";
  constructor() {
    super(`You can star at most ${MAX_FAVORITES} tools. Remove one first.`);
    this.name = "TooManyFavoritesError";
  }
}

/** True when the id names a real tool. */
export function isKnownTool(toolId: string): boolean {
  return getTool(toolId) !== undefined;
}

/** This user's starred tool ids, most recently starred first. */
export async function listFavorites(
  userId: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<string[]> {
  const rows = await prisma.favorite.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { toolId: "asc" }],
    select: { toolId: true },
  });
  // A tool can be retired between releases; drop anything the registry no longer knows so the
  // UI never has to render a star with no tool behind it.
  return (rows as { toolId: string }[]).map((r) => r.toolId).filter(isKnownTool);
}

/** Sets one favourite on or off. Returns the full list afterwards, so the UI needs one call. */
export async function setFavorite(
  userId: string,
  toolId: string,
  on: boolean,
  prisma: PrismaClient = requirePrisma(),
): Promise<string[]> {
  if (!isKnownTool(toolId)) throw new UnknownFavoriteToolError(toolId);
  if (on) {
    const count = await prisma.favorite.count({ where: { userId } });
    if (count >= MAX_FAVORITES) throw new TooManyFavoritesError();
    await prisma.favorite.upsert({
      where: { userId_toolId: { userId, toolId } },
      create: { userId, toolId },
      update: {},
    });
  } else {
    await prisma.favorite.deleteMany({ where: { userId, toolId } });
  }
  return listFavorites(userId, prisma);
}

/** Flips one favourite. Returns the list and whether the tool is now starred. */
export async function toggleFavorite(
  userId: string,
  toolId: string,
  prisma: PrismaClient = requirePrisma(),
): Promise<{ favorites: string[]; on: boolean }> {
  if (!isKnownTool(toolId)) throw new UnknownFavoriteToolError(toolId);
  const existing = await prisma.favorite.findUnique({
    where: { userId_toolId: { userId, toolId } },
  });
  const favorites = await setFavorite(userId, toolId, !existing, prisma);
  return { favorites, on: !existing };
}

/**
 * Merges a guest's device favourites into the account, keeping whatever is already starred.
 * Used by the one-time import a guest can run after signing in.
 */
export async function mergeFavorites(
  userId: string,
  toolIds: string[],
  prisma: PrismaClient = requirePrisma(),
): Promise<string[]> {
  const wanted = [...new Set(toolIds.filter(isKnownTool))];
  if (wanted.length > 0) {
    const room = MAX_FAVORITES - (await prisma.favorite.count({ where: { userId } }));
    for (const toolId of wanted.slice(0, Math.max(0, room))) {
      await prisma.favorite.upsert({
        where: { userId_toolId: { userId, toolId } },
        create: { userId, toolId },
        update: {},
      });
    }
  }
  return listFavorites(userId, prisma);
}
