// A shared read-only result (21-roadmap-expansion.md, roadmap §2).
//
// Anyone with the link sees the finished files and nothing else: no history, no account, no way back
// into the owner's data. "Not found", "revoked" and a wrong passphrase all render the same page, so
// the URL cannot be used to test whether a share ever existed.
import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardDescription, CardTitle, buttonClasses } from "@onestop/ui";
import { getPrisma, outputFiles, resolveShare, toJobFromRow } from "@onestop/api";
import { getTool } from "@onestop/tool-registry";
import { EmptyState } from "@/components/fx/EmptyState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared result",
  // A share link is not something to index: it is meant for one recipient.
  robots: { index: false, follow: false },
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default async function SharedResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const passphrase = typeof query.p === "string" ? query.p : null;
  const prisma = getPrisma();

  const unavailable = (
    <EmptyState
      kind="no-results"
      title="This link is not available"
      description="It may have expired, been revoked, or never existed. Shared results are deliberately short-lived — ask whoever sent it for a fresh link."
      action={
        <Link href="/" className={buttonClasses("secondary")}>
          Go to OneStop
        </Link>
      }
    />
  );

  if (!prisma) return unavailable;
  const lookup = await resolveShare(slug, passphrase, prisma);

  if (!lookup.ok && lookup.reason === "passphrase") {
    return (
      <Card className="mx-auto flex max-w-md flex-col gap-4">
        <div>
          <CardTitle>This result is passphrase-protected</CardTitle>
          <CardDescription>Enter the passphrase whoever shared it gave you.</CardDescription>
        </div>
        <form method="get" className="flex flex-col gap-3">
          <label className="text-sm font-medium" htmlFor="share-passphrase">
            Passphrase
          </label>
          <input
            id="share-passphrase"
            name="p"
            type="password"
            autoComplete="off"
            required
            className="h-10 rounded-md border border-border bg-surface px-3"
          />
          <button type="submit" className={buttonClasses("primary")}>
            Open
          </button>
        </form>
      </Card>
    );
  }
  if (!lookup.ok) return unavailable;

  const row = (await prisma.job.findUnique({ where: { id: lookup.share.jobId } })) as Parameters<
    typeof toJobFromRow
  >[0] | null;
  if (!row) return unavailable;
  const job = toJobFromRow(row);
  const files = outputFiles(job);
  const tool = getTool(job.toolId);
  const expires = new Date(lookup.share.expiresAt);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <div>
          <CardTitle>{lookup.share.title ?? `${tool?.name ?? "Result"} from OneStop`}</CardTitle>
          <CardDescription>
            Shared with you as a read-only link. It stops working {expires.toLocaleString()}, and the
            files are deleted from the server at the same time.
          </CardDescription>
        </div>

        {files.length === 0 ? (
          <EmptyState
            kind="empty-folder"
            title="Nothing to download"
            description="This result produced no files — it may have been an answer shown on screen rather than something to save."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {files.map((file) => (
              <li
                key={file.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{file.name}</span>
                  <span className="block text-xs text-fg-muted">
                    {formatBytes(file.size)} · {file.mimeType}
                  </span>
                </span>
                <a href={`/api/files/${file.id}`} download={file.name} className={buttonClasses("primary", "sm")}>
                  Download
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-center text-xs text-fg-muted">
        Made with{" "}
        <Link href="/" className="underline">
          OneStop
        </Link>
        . Nothing on this page is tracked, and you do not need an account to download it.
      </p>
    </div>
  );
}
