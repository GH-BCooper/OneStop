"use client";

// `/history` (14-history-favorites.md).
//
// One component serves both audiences, because both hand it the same `HistoryPage` shape:
//
//   signed in - `/api/history`, filtered and paged in Postgres, synced across devices;
//   guest     - IndexedDB on this device, filtered and paged in the browser with no network call
//               for the history feature at all.
//
// The banner at the top says which of the two is in force, so nobody has to guess where their
// history lives or why it vanished when they cleared site data.
import { getTool, GROUPS, toolHref, tools } from "@onestop/tool-registry";
import type { HistoryEntry, HistoryPage } from "@onestop/types";
import { Badge, Button, buttonClasses, Card } from "@onestop/ui";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { readLocalFavorites } from "@/lib/favorites";
import {
  historyQueryString,
  HISTORY_STATUSES,
  toolIdsInCategory,
  type HistoryParams,
} from "@/lib/history-params";
import {
  clearLocalHistory,
  deleteLocalEntry,
  filterLocalHistory,
  readLocalHistory,
} from "@/lib/localHistory";

const fieldClass =
  "h-10 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-sm text-fg focus-visible:outline-2 focus-visible:outline-ring";

const EMPTY: HistoryPage = { entries: [], total: 0, page: 1, pageSize: 20, pageCount: 1 };

const statusTone: Record<string, "success" | "danger" | "primary" | "neutral"> = {
  success: "success",
  failed: "danger",
  processing: "primary",
  validating: "primary",
  pending: "neutral",
};

function formatWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function toolName(toolId: string): string {
  return getTool(toolId)?.name ?? toolId;
}

/** A result file is only downloadable until the pipeline's retention window closes. */
function stillAvailable(expiresAt: string): boolean {
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && at > Date.now();
}

export interface HistoryViewProps {
  initial: HistoryParams;
  /** True when this instance has accounts at all; false hides the sign-in prompts. */
  accountsEnabled: boolean;
}

export function HistoryView({ initial, accountsEnabled }: HistoryViewProps) {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const signedIn = Boolean(session?.user);
  const [params, setParams] = useState<HistoryParams>(initial);
  const [page, setPage] = useState<HistoryPage>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [localCount, setLocalCount] = useState(0);
  const [importing, setImporting] = useState(false);

  const query = historyQueryString(params);

  const load = useCallback(async () => {
    setLoading(true);
    if (signedIn) {
      try {
        const response = await fetch(`/api/history${query}`);
        const body = (await response.json()) as HistoryPage & { ok?: boolean };
        setPage(response.ok ? body : EMPTY);
      } catch {
        setPage(EMPTY);
        setNotice("Your history could not be loaded. Check your connection and try again.");
      }
    } else {
      const entries = await readLocalHistory();
      setPage(
        filterLocalHistory(entries, {
          ...(params.toolId ? { toolId: params.toolId } : {}),
          ...(params.category && !params.toolId
            ? { toolIds: toolIdsInCategory(params.category) }
            : {}),
          ...(params.status ? { status: params.status } : {}),
          ...(params.from ? { from: params.from } : {}),
          ...(params.to ? { to: params.to } : {}),
          page: params.page ?? 1,
        }),
      );
    }
    setLoading(false);
  }, [signedIn, query, params]);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    void load();
  }, [load, sessionStatus]);

  // How much is still sitting on this device, so a signed-in user can be offered the import.
  useEffect(() => {
    void readLocalHistory().then((entries) => setLocalCount(entries.length));
  }, []);

  const update = (patch: Partial<HistoryParams>) => {
    const next: HistoryParams = { ...params, page: 1, ...patch };
    setParams(next);
    router.replace(`/history${historyQueryString(next)}`, { scroll: false });
  };

  const goToPage = (n: number) => {
    const next = { ...params, page: n };
    setParams(next);
    router.replace(`/history${historyQueryString(next)}`, { scroll: false });
  };

  const removeEntry = async (entry: HistoryEntry) => {
    if (entry.scope === "device") await deleteLocalEntry(entry.id);
    else await fetch(`/api/history/${entry.id}`, { method: "DELETE" });
    await load();
  };

  const clearAll = async () => {
    if (!confirm("Forget every run in this history? This cannot be undone.")) return;
    if (signedIn) await fetch("/api/history", { method: "DELETE" });
    else await clearLocalHistory();
    setLocalCount(signedIn ? localCount : 0);
    await load();
  };

  const importLocal = async () => {
    setImporting(true);
    try {
      const entries = await readLocalHistory();
      const response = await fetch("/api/history/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entries: entries.map((e) => ({
            toolId: e.toolId,
            status: e.status,
            createdAt: e.createdAt,
            summary: e.summary,
            inputs: e.inputs,
          })),
          favorites: readLocalFavorites(),
        }),
      });
      const body = (await response.json()) as { ok?: boolean; imported?: number };
      if (!body.ok) {
        setNotice("That import did not go through. Please try again.");
        return;
      }
      await clearLocalHistory();
      setLocalCount(0);
      setNotice(
        `Imported ${body.imported ?? 0} run${body.imported === 1 ? "" : "s"} from this device.`,
      );
      await load();
    } finally {
      setImporting(false);
    }
  };

  const toolOptions = useMemo(() => {
    const inCategory = params.category ? new Set(toolIdsInCategory(params.category)) : null;
    return tools
      .filter((t) => !inCategory || inCategory.has(t.id))
      .map((t) => ({ id: t.id, name: t.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [params.category]);

  const filtered = Boolean(
    params.category || params.toolId || params.status || params.from || params.to,
  );

  return (
    <div className="flex flex-col gap-6">
      {accountsEnabled && !signedIn && sessionStatus !== "loading" && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-dashed text-sm">
          <p className="text-fg-muted">
            This history is kept on <strong className="text-fg">this device only</strong>, in your
            browser&rsquo;s storage. Clearing site data clears it, and it does not follow you to
            another browser.
          </p>
          <Link href="/auth/login?next=/history" className={buttonClasses("secondary", "sm")}>
            Sign in to save your history
          </Link>
        </Card>
      )}

      {signedIn && localCount > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-dashed text-sm">
          <p className="text-fg-muted">
            There {localCount === 1 ? "is" : "are"} {localCount} run
            {localCount === 1 ? "" : "s"} saved on this device from before you signed in.
          </p>
          <Button size="sm" variant="secondary" onClick={importLocal} disabled={importing}>
            {importing ? "Importing…" : "Import into my account"}
          </Button>
        </Card>
      )}

      {notice && (
        <p role="status" className="rounded-md border border-border bg-surface p-3 text-sm">
          {notice}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col gap-1">
          <label htmlFor="history-category" className="text-sm font-medium">
            Category
          </label>
          <select
            id="history-category"
            className={fieldClass}
            value={params.category}
            onChange={(e) => update({ category: e.target.value, toolId: undefined })}
          >
            <option value="">All categories</option>
            {GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="history-tool" className="text-sm font-medium">
            Tool
          </label>
          <select
            id="history-tool"
            className={fieldClass}
            value={params.toolId ?? ""}
            onChange={(e) => update({ toolId: e.target.value || undefined })}
          >
            <option value="">All tools</option>
            {toolOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="history-status" className="text-sm font-medium">
            Status
          </label>
          <select
            id="history-status"
            className={fieldClass}
            value={params.status ?? ""}
            onChange={(e) =>
              update({ status: (e.target.value || undefined) as HistoryParams["status"] })
            }
          >
            <option value="">Any status</option>
            {HISTORY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="history-from" className="text-sm font-medium">
            From
          </label>
          <input
            id="history-from"
            type="date"
            className={fieldClass}
            value={params.from ?? ""}
            onChange={(e) => update({ from: e.target.value || undefined })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="history-to" className="text-sm font-medium">
            To
          </label>
          <input
            id="history-to"
            type="date"
            className={fieldClass}
            value={params.to ?? ""}
            onChange={(e) => update({ to: e.target.value || undefined })}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-muted" aria-live="polite">
          {loading
            ? "Loading…"
            : `${page.total} ${page.total === 1 ? "run" : "runs"}${filtered ? " match these filters" : ""}`}
        </p>
        <div className="flex gap-2">
          {filtered && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                update({
                  category: "",
                  toolId: undefined,
                  status: undefined,
                  from: undefined,
                  to: undefined,
                })
              }
            >
              Clear filters
            </Button>
          )}
          {page.total > 0 && (
            <Button size="sm" variant="ghost" onClick={clearAll}>
              Clear history
            </Button>
          )}
        </div>
      </div>

      {!loading && page.entries.length === 0 ? (
        <Card className="flex flex-col items-start gap-3 border-dashed">
          <p className="text-fg-muted">
            {filtered
              ? "Nothing matches those filters yet."
              : "Nothing here yet. Every tool you run is listed on this page."}
          </p>
          <Link href="/tools" className={buttonClasses("secondary", "sm")}>
            Browse the tools
          </Link>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Past runs">
          {page.entries.map((entry) => {
            const tool = getTool(entry.toolId);
            const downloads = entry.outputs.filter((f) => stillAvailable(f.expiresAt));
            return (
              <li key={entry.id}>
                <Card className="flex flex-col gap-2" data-history-entry={entry.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {tool ? (
                          <Link href={toolHref(tool)} className="hover:text-primary">
                            {tool.name}
                          </Link>
                        ) : (
                          toolName(entry.toolId)
                        )}
                      </p>
                      <p className="text-xs text-fg-muted">
                        {formatWhen(entry.createdAt)}
                        {entry.inputs.length > 0 && ` · ${entry.inputs.join(", ")}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={statusTone[entry.status] ?? "neutral"}>{entry.status}</Badge>
                      {entry.scope === "device" && <Badge>This device</Badge>}
                    </div>
                  </div>

                  {entry.summary && <p className="text-sm">{entry.summary}</p>}
                  {entry.error && <p className="text-sm text-danger">{entry.error}</p>}

                  <div className="flex flex-wrap items-center gap-2">
                    {downloads.map((file) => (
                      <a
                        key={file.id}
                        href={`/api/files/${file.id}`}
                        download={file.name}
                        className={buttonClasses("secondary", "sm")}
                      >
                        Download {file.name}
                      </a>
                    ))}
                    {entry.outputs.length > 0 && downloads.length === 0 && (
                      <span className="text-xs text-fg-muted">
                        The result files have been deleted from the server — run the tool again to
                        get them back.
                      </span>
                    )}
                    {tool && (
                      <Link href={toolHref(tool)} className={buttonClasses("ghost", "sm")}>
                        Run again
                      </Link>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => void removeEntry(entry)}>
                      Remove
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {page.pageCount > 1 && (
        <nav aria-label="History pages" className="flex items-center justify-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            disabled={page.page <= 1}
            onClick={() => goToPage(page.page - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-fg-muted">
            Page {page.page} of {page.pageCount}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page.page >= page.pageCount}
            onClick={() => goToPage(page.page + 1)}
          >
            Next
          </Button>
        </nav>
      )}
    </div>
  );
}
