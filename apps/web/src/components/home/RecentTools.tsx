"use client";

// Favourites and recently-used tools on the Home page (14-history-favorites.md).
//
// Phase 02 shipped this as "tools opened on this device", read from localStorage. It now shows
// two rows: the tools the user has starred (from the account when signed in, from this device
// otherwise) and the tools they have actually *run*, taken from real history rather than from
// which pages they happened to open.
import { getTool, toolHref } from "@onestop/tool-registry";
import Link from "next/link";
import { FavoriteButton } from "@/components/tools/FavoriteButton";
import { useFavorites } from "@/lib/use-favorites";
import { useUsage } from "@/lib/use-usage";

function ToolPill({ id }: { id: string }) {
  const tool = getTool(id);
  if (!tool) return null;
  return (
    <li>
      <Link
        href={toolHref(tool)}
        className="inline-block rounded-full border border-border bg-surface px-3 py-1.5 text-sm hover:border-primary hover:text-primary"
      >
        {tool.name}
      </Link>
    </li>
  );
}

export function RecentTools() {
  const { favorites, synced } = useFavorites();
  const { recent } = useUsage();

  const starred = favorites.filter((id) => getTool(id) !== undefined).slice(0, 8);
  // A starred tool is already one click away above, so it does not need repeating here.
  const used = recent.filter((id) => getTool(id) && !starred.includes(id)).slice(0, 6);
  if (starred.length === 0 && used.length === 0) return null;

  return (
    <div className="flex flex-col gap-8">
      {starred.length > 0 && (
        <section aria-labelledby="favorites-heading" className="flex flex-col gap-4">
          <div className="flex items-baseline gap-3">
            <h2 id="favorites-heading" className="text-xl font-semibold">
              Your favourites
            </h2>
            <span className="text-xs text-fg-muted">
              {synced ? "Synced to your account" : "Saved on this device"}
            </span>
          </div>
          <ul className="flex flex-wrap items-center gap-2">
            {starred.map((id) => {
              const tool = getTool(id)!;
              return (
                <li key={id} className="flex items-center gap-1">
                  <Link
                    href={toolHref(tool)}
                    className="inline-block rounded-full border border-primary bg-surface px-3 py-1.5 text-sm text-primary hover:bg-surface-muted"
                  >
                    {tool.name}
                  </Link>
                  <FavoriteButton toolId={tool.id} toolName={tool.name} />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {used.length > 0 && (
        <section aria-labelledby="recent-heading" className="flex flex-col gap-4">
          <h2 id="recent-heading" className="text-xl font-semibold">
            Recently used
          </h2>
          <ul className="flex flex-wrap gap-2">
            {used.map((id) => (
              <ToolPill key={id} id={id} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
