// QR Code Analytics (11-qr-tools.md).
//
// Deliberately minimal and privacy-first (master plan 15): a scan is a timestamp plus a coarse
// device family, never an IP address or anything that identifies a person. That is enough to
// answer the questions the tool exists for - is this poster working, and when was it last used.
import type { Executor } from "@onestop/tool-registry";
import { optEnum, runQrTool } from "./common.ts";
import { getQrStore, shortUrlFor, type QrLink } from "./store.ts";

export interface QrStats {
  id: string;
  title: string;
  kind: QrLink["kind"];
  shortUrl: string;
  destination?: string;
  active: boolean;
  scans: number;
  lastScannedAt: string | null;
  createdAt: string;
  /** Scans in the last 7 days, from the retained window. */
  scansLast7Days: number;
  /** How many times the destination has been changed since the code was made. */
  destinationChanges: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function statsFor(link: QrLink, now = Date.now()): QrStats {
  const since = now - 7 * DAY_MS;
  return {
    id: link.id,
    title: link.title,
    kind: link.kind,
    shortUrl: shortUrlFor(link.id),
    ...(link.target ? { destination: link.target } : {}),
    active: link.active,
    scans: link.scanCount,
    lastScannedAt: link.lastScannedAt,
    createdAt: link.createdAt,
    scansLast7Days: link.scans.filter((s) => Date.parse(s.at) >= since).length,
    destinationChanges: Math.max(0, link.history.length - 1),
  };
}

/** Day-by-day totals for the retained window, oldest first. */
export function scansByDay(link: QrLink): { date: string; scans: number }[] {
  const byDay = new Map<string, number>();
  for (const scan of link.scans) {
    const day = scan.at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, scans]) => ({ date, scans }));
}

export async function qrAnalytics(ownerToken?: string | null): Promise<QrStats[]> {
  const links = await getQrStore().list(ownerToken);
  return links.map((link) => statsFor(link));
}

export const qrAnalyticsExecutor: Executor = (_input, options) =>
  runQrTool("qr-code-analytics", async () => {
    // TODO(13-auth-database.md): filter by the signed-in user once accounts exist. Until then the
    // executor has no request context, so it reports every code this OneStop instance holds.
    const links = await getQrStore().list();
    const detail = optEnum(options, "detail", ["summary", "full"] as const, "summary");
    const codes = links.map((link) => ({
      ...statsFor(link),
      ...(detail === "full"
        ? { byDay: scansByDay(link), recentScans: link.scans.slice(-20).reverse() }
        : {}),
    }));
    const total = codes.reduce((sum, c) => sum + c.scans, 0);
    const scanned = codes.filter((c) => c.scans > 0).length;
    const lastScan = codes
      .map((c) => c.lastScannedAt)
      .filter((v): v is string => Boolean(v))
      .sort()
      .pop();
    return {
      ok: true,
      output: {
        codes,
        totals: {
          codes: codes.length,
          scans: total,
          everScanned: scanned,
          lastScannedAt: lastScan ?? null,
        },
      },
      summary:
        codes.length === 0
          ? "No dynamic QR codes yet. Make one with Dynamic QR Code, Custom QR Landing Page or QR Code -> Content Page."
          : `${codes.length} code${codes.length === 1 ? "" : "s"}, ${total} scan${total === 1 ? "" : "s"} in total${lastScan ? `, last scanned ${lastScan}` : ""}.`,
    };
  });
