"use client";

import { getTool, toolHref } from "@onestop/tool-registry";
import Link from "next/link";
import { useEffect, useState } from "react";
import { readRecentTools } from "@/lib/recent-tools";

/** Tools opened on this device. Renders nothing until there are some. */
// TODO(14-history-favorites.md): use synced history for signed-in users.
export function RecentTools() {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => setIds(readRecentTools().slice(0, 6)), []);

  const recent = ids.map(getTool).filter((t) => t !== undefined);
  if (recent.length === 0) return null;

  return (
    <section aria-labelledby="recent-heading" className="flex flex-col gap-4">
      <h2 id="recent-heading" className="text-xl font-semibold">
        Recently used
      </h2>
      <ul className="flex flex-wrap gap-2">
        {recent.map((t) => (
          <li key={t.id}>
            <Link
              href={toolHref(t)}
              className="inline-block rounded-full border border-border bg-surface px-3 py-1.5 text-sm hover:border-primary hover:text-primary"
            >
              {t.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
