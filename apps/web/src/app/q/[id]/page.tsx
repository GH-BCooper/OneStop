// /q/<id> — what a dynamic QR code actually opens (11-qr-tools.md).
//
// This is the stable half of a dynamic code: the id in the URL is printed into the QR image and
// never changes, while what it resolves to is stored server-side and can be edited at any time.
// Every hit counts as one scan, which is where QR Code Analytics gets its numbers.
import { resolveQrLink, isQrLinkId, type QrScan } from "@onestop/api";
import { Card } from "@onestop/ui";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { QRLandingPage } from "@/components/qr/QRLandingPage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Scanned code",
  // A scanned code is a one-off destination, not something to index.
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * Coarse device family only — never an IP address, never a full user-agent string, so the scan
 * log cannot be turned into a record of who scanned what (master plan §15).
 */
function deviceFamily(userAgent: string): string {
  if (/iphone|ipad|ipod/i.test(userAgent)) return "iOS";
  if (/android/i.test(userAgent)) return "Android";
  if (/windows/i.test(userAgent)) return "Windows";
  if (/mac os x/i.test(userAgent)) return "macOS";
  if (/linux/i.test(userAgent)) return "Linux";
  return "other";
}

export default async function ScannedCodeRoute({ params }: Props) {
  const { id } = await params;
  if (!isQrLinkId(id)) return <MissingCode />;

  const headerList = await headers();
  const scan: Omit<QrScan, "at"> = { device: deviceFamily(headerList.get("user-agent") ?? "") };
  const referrer = headerList.get("referer");
  if (referrer) {
    // Only the host, so a scan never records the full page somebody came from.
    try {
      scan.referrer = new URL(referrer).host;
    } catch {
      // An unparseable referrer is simply left out.
    }
  }

  const resolved = await resolveQrLink(id, scan);

  if (resolved.status === "missing") return <MissingCode />;

  if (resolved.status === "paused") {
    return (
      <Card className="mx-auto flex max-w-lg flex-col gap-2 border-warning">
        <h1 className="text-xl font-semibold">This code is paused</h1>
        <p className="text-fg-muted">
          Its owner has turned it off for now. Try again later, or ask them to switch it back on.
        </p>
      </Card>
    );
  }

  if (resolved.status === "redirect") {
    // A temporary redirect on purpose: the destination is meant to change.
    redirect(resolved.target);
  }

  return <QRLandingPage page={resolved.page} code={id} scans={resolved.link.scanCount} />;
}

function MissingCode() {
  return (
    <Card className="mx-auto flex max-w-lg flex-col gap-2 border-danger">
      <h1 className="text-xl font-semibold">This code is no longer active</h1>
      <p className="text-fg-muted">
        It may have been deleted by whoever made it. If you scanned a printed code, ask them for an
        up-to-date one.
      </p>
      <Link href="/tools/qr" className="text-primary underline">
        Browse OneStop&apos;s QR tools
      </Link>
    </Card>
  );
}
