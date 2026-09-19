// The service worker's navigation fallback (18-pwa-offline.md).
//
// Reached only when a page was never cached and the network is gone. It is a real route, so it is
// precached with the shell, and it must render with no data of its own - no registry read, no
// database, no fetch.
import { buttonClasses, Card, CardDescription, CardTitle } from "@onestop/ui";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Offline",
  description: "This page is not available offline. Here is what still works.",
};

const works = [
  { href: "/tools", title: "All Tools", detail: "Browse the catalogue you have already opened." },
  {
    href: "/status",
    title: "Status",
    detail: "See exactly which tools work without a connection.",
  },
  { href: "/history", title: "History", detail: "Your device history is stored locally." },
];

export default function OfflinePage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">You are offline</h1>
        <p className="text-fg-muted">
          This page was not saved for offline use. Reconnect to open it — the pages you have already
          visited are still available, and tools that run on your device keep working once OneStop
          itself is reachable.
        </p>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {works.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="block h-full rounded-lg">
              <Card interactive className="h-full">
                <CardTitle>{item.title}</CardTitle>
                <CardDescription>{item.detail}</CardDescription>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
      <div>
        <Link href="/" className={buttonClasses("primary")}>
          Back to OneStop
        </Link>
      </div>
    </div>
  );
}
