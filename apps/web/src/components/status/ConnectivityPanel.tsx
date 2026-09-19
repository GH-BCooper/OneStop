"use client";

// The live half of /status (18-pwa-offline.md): the verified connection state, what the service
// worker has cached, and whether this is the installed app or a browser tab.
import { Badge, Button, Card } from "@onestop/ui";
import { useCallback, useEffect, useState } from "react";
import { describeReach } from "@/lib/connectivity";
import {
  clearCaches,
  isStandalone,
  readCacheStatus,
  serviceWorkerEnabled,
  serviceWorkerSupported,
  type CacheStatus,
} from "@/lib/service-worker";
import { useConnectivity } from "@/lib/use-connectivity";

function when(timestamp: number | null): string {
  if (!timestamp) return "not yet";
  return new Date(timestamp).toLocaleTimeString();
}

export function ConnectivityPanel() {
  const { reach, navigatorOnline, appReachable, internetReachable, checkedAt, detail, recheck } =
    useConnectivity();
  const described = describeReach(reach);
  const [cache, setCache] = useState<CacheStatus | null>(null);
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);
  // Rendered only after mount: the answers depend on the browser, so the server cannot know them.
  const [mounted, setMounted] = useState(false);

  const refreshCache = useCallback(async () => {
    setCache(await readCacheStatus());
  }, []);

  useEffect(() => {
    setMounted(true);
    setInstalled(isStandalone());
    void refreshCache();
  }, [refreshCache]);

  const swState = !mounted
    ? "Checking…"
    : !serviceWorkerSupported()
      ? "Not supported by this browser — everything still works online."
      : !serviceWorkerEnabled()
        ? "Disabled in development (set NEXT_PUBLIC_ENABLE_SW=1 to test it)."
        : cache
          ? `Active (${cache.version}), ${cache.entries} cached ${cache.entries === 1 ? "entry" : "entries"}.`
          : "Registered — reload once to let it take over this page.";

  return (
    <section aria-labelledby="connection-heading" className="flex flex-col gap-3">
      <h2 id="connection-heading" className="text-xl font-semibold">
        This device right now
      </h2>
      <Card className="gap-4" data-testid="connectivity-panel" data-reach={reach}>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={described.tone}>{described.label}</Badge>
          <p className="min-w-0 text-sm">{described.detail}</p>
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void Promise.all([recheck(), refreshCache()]).finally(() => setBusy(false));
            }}
          >
            Check again
          </Button>
        </div>

        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {[
            {
              term: "Browser reports a network",
              value: navigatorOnline ? "yes" : "no",
              note: "navigator.onLine — a hint, not proof.",
            },
            {
              term: "OneStop app reachable",
              value: appReachable ? "yes" : "no",
              note: "Verified with a request to this server.",
            },
            {
              term: "Server can reach the Internet",
              value: internetReachable === null ? "unknown" : internetReachable ? "yes" : "no",
              note: "Only tools marked as needing the Internet depend on this.",
            },
            {
              term: "Last checked",
              value: mounted ? when(checkedAt) : "…",
              note: detail ?? "Re-checked every minute while this tab is open.",
            },
          ].map((row) => (
            <div key={row.term} className="rounded-lg border border-border/60 p-2">
              <dt className="font-medium">{row.term}</dt>
              <dd className="text-fg-muted">
                <span className="font-mono">{row.value}</span> — {row.note}
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-col gap-2 border-t border-border pt-3 text-sm">
          <p>
            <span className="font-medium">Offline cache:</span>{" "}
            <span data-testid="sw-state">{swState}</span>
          </p>
          <p className="text-fg-muted">
            <span className="font-medium text-fg">Running as:</span>{" "}
            {mounted ? (installed ? "installed app (standalone)" : "browser tab") : "…"}. Install
            OneStop from your browser&rsquo;s address bar to get an app window, an icon and camera
            access for QR scanning.
          </p>
          {cache && (
            <p className="text-fg-muted">
              Cached shell pages: <span className="font-mono">{cache.shellCached.join(", ")}</span>
            </p>
          )}
          {cache && (
            <div>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void clearCaches()
                    .then(() => refreshCache())
                    .finally(() => setBusy(false));
                }}
              >
                Clear and rebuild the offline cache
              </Button>
            </div>
          )}
        </div>
      </Card>
    </section>
  );
}
