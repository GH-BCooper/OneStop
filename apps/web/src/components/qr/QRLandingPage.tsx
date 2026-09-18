// The page a hosted QR code opens (11-qr-tools.md).
//
// It is rendered on the server from the stored blocks, and is deliberately plain: someone has
// just pointed a phone at a poster, so it has to load fast, read well at arm's length and work
// without JavaScript. Attachments are inlined as data URLs while storage is interim (store.ts).
import type { QrPage, QrPageBlock } from "@onestop/api";

/** Only the colours we produced ourselves are ever written into a style attribute. */
function safeAccent(accent: string | undefined): string {
  return accent && /^#[0-9a-fA-F]{3,8}$/.test(accent) ? accent : "#2563eb";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function Block({ block, accent }: { block: QrPageBlock; accent: string }) {
  switch (block.type) {
    case "heading":
      return <h2 className="text-xl font-semibold">{block.text}</h2>;
    case "text":
      return <p className="text-base whitespace-pre-wrap">{block.text}</p>;
    case "link":
      return (
        <a
          href={block.url}
          rel="noreferrer noopener"
          className="inline-flex h-12 items-center justify-center rounded-lg px-5 font-medium text-white"
          style={{ backgroundColor: accent }}
        >
          {block.text || block.url}
        </a>
      );
    case "image":
      return (
        // The source is a data: URL held in this app's own store, so next/image would only add a
        // pointless optimisation round trip.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={block.data}
          alt={block.text ?? "Shared image"}
          className="w-full rounded-lg border border-border"
        />
      );
    case "audio":
      return (
        <figure className="flex flex-col gap-2">
          <audio controls src={block.data} className="w-full">
            Your browser cannot play this audio.
          </audio>
          <figcaption className="text-sm text-fg-muted">{block.text}</figcaption>
        </figure>
      );
    case "file":
      return (
        <a
          href={block.data}
          download={block.fileName}
          className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm hover:border-primary"
        >
          <span className="truncate">{block.fileName ?? block.text}</span>
          <span className="shrink-0 text-fg-muted">
            {block.size ? formatBytes(Math.round((block.size * 3) / 4)) : "Download"}
          </span>
        </a>
      );
    default:
      return null;
  }
}

export interface QRLandingPageProps {
  page: QrPage;
  /** Shown in small print, so the owner can tell which code was scanned. */
  code?: string;
  scans?: number;
}

export function QRLandingPage({ page, code, scans }: QRLandingPageProps) {
  const accent = safeAccent(page.accent);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6" data-testid="qr-landing">
      <header className="flex flex-col gap-2 border-b border-border pb-4">
        <h1 className="text-3xl font-bold" style={{ color: accent }}>
          {page.title}
        </h1>
        {page.subtitle && <p className="text-lg text-fg-muted">{page.subtitle}</p>}
      </header>

      <div className="flex flex-col gap-5">
        {page.blocks.map((block, index) => (
          <Block key={`${block.type}-${index}`} block={block} accent={accent} />
        ))}
      </div>

      <footer className="border-t border-border pt-4 text-xs text-fg-muted">
        Shared with OneStop{code ? ` · code ${code}` : ""}
        {typeof scans === "number" ? ` · ${scans} scan${scans === 1 ? "" : "s"}` : ""}
      </footer>
    </div>
  );
}
