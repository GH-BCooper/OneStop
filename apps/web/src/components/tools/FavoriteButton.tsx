"use client";

// The star that appears on every tool card and tool page (14-history-favorites.md).
//
// It is a real button with `aria-pressed`, not a checkbox dressed up as one, so a screen reader
// announces "Favourite, pressed". On a card the whole card is a link, so the click is stopped
// from bubbling into it.
import { useFavorites } from "@/lib/use-favorites";

export interface FavoriteButtonProps {
  toolId: string;
  toolName: string;
  /** `inline` sits in a card corner; `standalone` is a labelled button on the tool page. */
  variant?: "inline" | "standalone";
  className?: string;
}

export function FavoriteButton({
  toolId,
  toolName,
  variant = "inline",
  className = "",
}: FavoriteButtonProps) {
  const { isFavorite, toggle, loading } = useFavorites();
  const on = isFavorite(toolId);
  const label = on ? `Remove ${toolName} from favourites` : `Add ${toolName} to favourites`;

  const base =
    variant === "standalone"
      ? "inline-flex h-10 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm"
      : "inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-base";

  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      data-favorite={on ? "on" : "off"}
      data-tool-id={toolId}
      disabled={loading}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggle(toolId);
      }}
      className={`${base} hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 ${
        on ? "text-primary" : "text-fg-muted"
      } ${className}`}
    >
      <span aria-hidden="true">{on ? "★" : "☆"}</span>
      {variant === "standalone" && <span>{on ? "Favourited" : "Favourite"}</span>}
    </button>
  );
}
