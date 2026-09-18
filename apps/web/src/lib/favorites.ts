// Favourite tools on the client (14-history-favorites.md).
//
// A guest's stars live in localStorage; a signed-in user's live in Postgres and are read and
// written through `/api/favorites`. Both paths hand back the same `string[]` of registry ids, so
// every component that shows a star is written once.
export const FAVORITES_KEY = "onestop-favorites";
export const FAVORITES_CHANGED = "onestop:favorites-changed";

export function readLocalFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function writeLocalFavorites(ids: string[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    // Storage can be blocked (private mode); a star is a convenience, never a requirement.
  }
  // Several components show stars at once (the tool cards, the home page). One event keeps them
  // in step without lifting the state into a provider.
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FAVORITES_CHANGED));
}

export function toggleLocalFavorite(toolId: string): string[] {
  const current = readLocalFavorites();
  const next = current.includes(toolId)
    ? current.filter((id) => id !== toolId)
    : [toolId, ...current];
  writeLocalFavorites(next);
  return next;
}

interface FavoritesResponse {
  ok?: boolean;
  favorites?: unknown;
}

function idsFrom(body: FavoritesResponse): string[] {
  return Array.isArray(body.favorites)
    ? body.favorites.filter((x): x is string => typeof x === "string")
    : [];
}

/** Reads the account's favourites. Falls back to this device's on any failure. */
export async function fetchFavorites(signal?: AbortSignal): Promise<string[]> {
  try {
    const response = await fetch("/api/favorites", { signal });
    if (!response.ok) return readLocalFavorites();
    return idsFrom((await response.json()) as FavoritesResponse);
  } catch {
    return readLocalFavorites();
  }
}

/** Flips one favourite on the account and returns the new list. */
export async function toggleRemoteFavorite(toolId: string): Promise<string[] | null> {
  try {
    const response = await fetch("/api/favorites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolId }),
    });
    if (!response.ok) return null;
    const ids = idsFrom((await response.json()) as FavoritesResponse);
    if (typeof window !== "undefined") window.dispatchEvent(new Event(FAVORITES_CHANGED));
    return ids;
  } catch {
    return null;
  }
}
