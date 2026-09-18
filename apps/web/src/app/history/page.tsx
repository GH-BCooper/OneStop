// `/history` — every tool run, for a signed-in user or a guest (14-history-favorites.md).
//
// The page itself is a thin server shell: it only parses the query string and reports whether
// this instance has accounts at all. The data comes from `/api/history` when signed in and from
// IndexedDB when not, so a guest's history costs no network call.
import type { Metadata } from "next";
import { HistoryView } from "@/components/history/HistoryView";
import { authIsConfigured } from "@/lib/auth-config";
import { parseHistoryParams } from "@/lib/history-params";

export const metadata: Metadata = { title: "History" };

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function HistoryPage({ searchParams }: Props) {
  const initial = parseHistoryParams((await searchParams) ?? {});

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">History</h1>
        <p className="mt-2 text-fg-muted">
          Every tool you have run, newest first. Result files are deleted from the server shortly
          after a run, so an older entry is a record of what you did, not a download.
        </p>
      </div>
      <HistoryView initial={initial} accountsEnabled={authIsConfigured()} />
    </div>
  );
}
