// A small, dependency-free renderer for the assistant's own Markdown replies (16-ai-assistant.md
// chat intent). Model output only ever needs the basics - bold/italic/code/links, headings and
// lists - so a tiny hand-rolled renderer avoids pulling in a full Markdown/HTML pipeline for it.
import { Fragment, type ReactNode } from "react";

const INLINE_RE =
  /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)|\*([^*]+)\*|_([^_]+)_/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text))) {
    if (m.index > lastIndex) nodes.push(text.slice(lastIndex, m.index));
    if (m[1] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-${key++}`}>{m[1]}</strong>);
    } else if (m[2] !== undefined) {
      nodes.push(
        <code
          key={`${keyPrefix}-${key++}`}
          className="rounded bg-surface-muted px-1 py-0.5 font-mono text-xs"
        >
          {m[2]}
        </code>,
      );
    } else if (m[3] !== undefined && m[4] !== undefined) {
      nodes.push(
        <a
          key={`${keyPrefix}-${key++}`}
          href={m[4]}
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium underline"
        >
          {m[3]}
        </a>,
      );
    } else if (m[5] !== undefined) {
      const url = m[5].replace(/[.,;:!?)]+$/, "");
      const tail = m[5].slice(url.length);
      nodes.push(
        <a
          key={`${keyPrefix}-${key++}`}
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium underline"
        >
          {url}
        </a>,
      );
      if (tail) nodes.push(tail);
    } else if (m[6] !== undefined) {
      nodes.push(<em key={`${keyPrefix}-${key++}`}>{m[6]}</em>);
    } else if (m[7] !== undefined) {
      nodes.push(<em key={`${keyPrefix}-${key++}`}>{m[7]}</em>);
    }
    lastIndex = INLINE_RE.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

const HEADER_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^(?:-|\*|\+)\s+(.*)$/;
const NUMBERED_RE = /^\d+[.)]\s+(.*)$/;

/** Renders a short Markdown reply: headings, bold/italic/code/links, and bullet/numbered lists. */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }

    const header = HEADER_RE.exec(line);
    if (header) {
      const level = header[1]!.length;
      const sizeClass = level <= 2 ? "text-base font-semibold" : "text-sm font-semibold";
      blocks.push(
        <p key={`b${blockKey++}`} className={sizeClass}>
          {renderInline(header[2]!, `h${blockKey}`)}
        </p>,
      );
      i++;
      continue;
    }

    if (BULLET_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && BULLET_RE.test(lines[i]!)) {
        items.push(BULLET_RE.exec(lines[i]!)![1]!);
        i++;
      }
      blocks.push(
        <ul key={`b${blockKey++}`} className="list-disc space-y-0.5 pl-5">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `li${blockKey}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (NUMBERED_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && NUMBERED_RE.test(lines[i]!)) {
        items.push(NUMBERED_RE.exec(lines[i]!)![1]!);
        i++;
      }
      blocks.push(
        <ol key={`b${blockKey++}`} className="list-decimal space-y-0.5 pl-5">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `oli${blockKey}-${idx}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !HEADER_RE.test(lines[i]!) &&
      !BULLET_RE.test(lines[i]!) &&
      !NUMBERED_RE.test(lines[i]!)
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    blocks.push(
      <p key={`b${blockKey++}`}>
        {paraLines.map((paraLine, idx) => (
          <Fragment key={idx}>
            {idx > 0 && <br />}
            {renderInline(paraLine, `p${blockKey}-${idx}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className="flex flex-col gap-2 text-sm">{blocks}</div>;
}
