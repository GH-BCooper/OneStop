"use client";

// One hook for every star in the app (14-history-favorites.md).
//
// Signed in, the list comes from (and goes back to) `/api/favorites`; as a guest it is this
// device's localStorage. The caller never has to know which - it gets an array and a toggle.
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import {
  FAVORITES_CHANGED,
  fetchFavorites,
  readLocalFavorites,
  toggleLocalFavorite,
  toggleRemoteFavorite,
} from "./favorites";

export interface UseFavorites {
  favorites: string[];
  isFavorite(toolId: string): boolean;
  toggle(toolId: string): void;
  /** True until the first read finishes, so a star never flickers on. */
  loading: boolean;
  /** True when stars are saved to the account rather than to this device. */
  synced: boolean;
}

export function useFavorites(): UseFavorites {
  const { data: session, status } = useSession();
  const signedIn = Boolean(session?.user);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "loading") return;
    let cancelled = false;
    const controller = new AbortController();
    const load = async () => {
      const ids = signedIn ? await fetchFavorites(controller.signal) : readLocalFavorites();
      if (cancelled) return;
      setFavorites(ids);
      setLoading(false);
    };
    void load();
    // Another component (or another tab) may have starred something since this one mounted.
    const refresh = () => {
      if (!signedIn) setFavorites(readLocalFavorites());
    };
    window.addEventListener(FAVORITES_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      cancelled = true;
      controller.abort();
      window.removeEventListener(FAVORITES_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [signedIn, status]);

  const toggle = useCallback(
    (toolId: string) => {
      // Optimistic: the star responds immediately and the server call catches up. If it fails,
      // the list is put back the way it was. The request is fired here rather than inside the
      // state updater, which React may run more than once and whose job is not side effects.
      const current = favorites;
      const next = current.includes(toolId)
        ? current.filter((id) => id !== toolId)
        : [toolId, ...current];
      setFavorites(next);
      if (signedIn) {
        void toggleRemoteFavorite(toolId).then((server) => setFavorites(server ?? current));
      } else {
        toggleLocalFavorite(toolId);
      }
    },
    [signedIn, favorites],
  );

  return {
    favorites,
    isFavorite: (toolId: string) => favorites.includes(toolId),
    toggle,
    loading: loading || status === "loading",
    synced: signedIn,
  };
}
