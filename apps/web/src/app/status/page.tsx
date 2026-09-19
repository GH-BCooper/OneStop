// /status - what works right now, online and offline (18-pwa-offline.md).
//
// Replaces the phase-02 placeholder. Two halves: the live one, measured in the browser
// (ConnectivityPanel), and the catalogue one, derived from the registry's `offline` flags
// (OfflineCatalogue). The dependency table is measured on the server, since that is where
// FFmpeg, yt-dlp and the AI runtime live.
import { Badge, Card } from "@onestop/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { ConnectivityPanel } from "@/components/status/ConnectivityPanel";
import { OfflineCatalogue } from "@/components/status/OfflineCatalogue";
import { groupOfflineSummaries, offlineTotals } from "@/lib/offline-status";
import { platformRows } from "@/lib/platform-status";

export const metadata: Metadata = {
  title: "Status",
  description: "Which tools work right now, including offline availability.",
};

// The dependency table probes the machine on every visit; a cached answer would be misleading.
export const dynamic = "force-dynamic";

const stateTone = { ok: "success", degraded: "warning", missing: "danger" } as const;
const stateLabel = { ok: "Ready", degraded: "Limited", missing: "Missing" } as const;

export default async function StatusPage() {
  const totals = offlineTotals();
  const groups = groupOfflineSummaries();
  const rows = await platformRows();

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Status</h1>
        <p className="text-fg-muted">
          OneStop processes files on the device that runs it, so most tools keep working with no
          Internet connection. This page shows the verified state of this install — nothing here is
          hard-coded.
        </p>
      </header>

      <ConnectivityPanel />

      <OfflineCatalogue totals={totals} groups={groups} />

      <section aria-labelledby="dependencies-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="dependencies-heading" className="text-xl font-semibold">
            Installed on the server
          </h2>
          <p className="text-sm text-fg-muted">
            Optional local programs and services. Everything marked <em>Limited</em> still leaves
            the app usable — it only means a smaller set of tools, or a lower-quality result.
          </p>
        </div>
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.name}>
              <Card
                className="gap-1"
                data-testid={`platform-${row.name.toLowerCase().replace(/\W+/g, "-")}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{row.name}</h3>
                  <Badge tone={stateTone[row.state]}>{stateLabel[row.state]}</Badge>
                  <span className="ml-auto font-mono text-sm text-fg-muted">{row.value}</span>
                </div>
                <p className="text-sm">{row.detail}</p>
                <p className="text-sm text-fg-muted">{row.affects}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="how-offline-heading" className="flex flex-col gap-3">
        <h2 id="how-offline-heading" className="text-xl font-semibold">
          How offline works here
        </h2>
        <Card className="gap-2 text-sm text-fg-muted">
          <p>
            <span className="font-medium text-fg">The app shell is cached.</span> After your first
            visit, OneStop opens with no connection: the pages you have visited come from the cache,
            and anything else shows the{" "}
            <Link href="/offline" className="text-primary hover:underline">
              offline page
            </Link>{" "}
            instead of a browser error.
          </p>
          <p>
            <span className="font-medium text-fg">Processing needs the app, not the Internet.</span>{" "}
            Files are converted by the OneStop server — the same machine when you run it locally —
            so tools listed above as working offline keep working while the uplink is down.
          </p>
          <p>
            <span className="font-medium text-fg">Online-only tools say so.</span> A tool that needs
            the Internet is blocked with a short message rather than failing halfway, and it becomes
            available again on its own when the connection returns.
          </p>
          <p>
            <span className="font-medium text-fg">Nothing is uploaded to us.</span> Temporary files
            are deleted automatically, and the connection check sends nothing but an empty request
            to a public endpoint to see whether the network answers.
          </p>
        </Card>
      </section>
    </div>
  );
}
