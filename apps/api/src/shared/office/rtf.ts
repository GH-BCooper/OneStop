// RTF → plain text / PDF, the no-LibreOffice fallback for .rtf (07-word-ppt-tools.md).
//
// A small RTF reader: groups, control words, `\'hh` (Windows-1252) and `\uN` escapes. Destinations
// that are not body text (font/colour/style tables, document info, pictures, fields' instructions)
// are skipped, so the result is the document's readable text with its paragraph breaks.
import { FlowPdf } from "./flowPdf.ts";

const SKIP_DESTINATIONS = new Set([
  "fonttbl",
  "colortbl",
  "stylesheet",
  "info",
  "pict",
  "object",
  "header",
  "footer",
  "headerl",
  "headerr",
  "headerf",
  "footerl",
  "footerr",
  "footerf",
  "fldinst",
  "listtable",
  "listoverridetable",
  "rsidtbl",
  "generator",
  "xmlnstbl",
  "themedata",
  "colorschememapping",
  "latentstyles",
  "datastore",
  "filetbl",
  "revtbl",
  "pgdsctbl",
]);

const CP1252 = new TextDecoder("windows-1252");

export function rtfToText(bytes: Uint8Array): string {
  const src = new TextDecoder("latin1").decode(bytes);
  if (!src.startsWith("{\\rtf")) return src;
  const out: string[] = [];
  // Per-group state: skipping this group, and how many chars to drop after \uN.
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false;
  let uc = 1;
  let pendingSkip = 0;
  let i = 0;
  const emit = (s: string) => {
    if (!skip) out.push(s);
  };
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "{") {
      stack.push({ skip, uc });
      i += 1;
      if (src.startsWith("\\*", i)) skip = true;
      continue;
    }
    if (ch === "}") {
      const prev = stack.pop();
      if (prev) ({ skip, uc } = prev);
      i += 1;
      continue;
    }
    if (ch === "\\") {
      const next = src[i + 1] ?? "";
      if (next === "\\" || next === "{" || next === "}") {
        if (pendingSkip > 0) pendingSkip -= 1;
        else emit(next);
        i += 2;
        continue;
      }
      if (next === "'") {
        const hex = src.slice(i + 2, i + 4);
        if (pendingSkip > 0) pendingSkip -= 1;
        else emit(CP1252.decode(new Uint8Array([parseInt(hex, 16) || 0x3f])));
        i += 4;
        continue;
      }
      if (next === "~") {
        emit(String.fromCharCode(0xa0));
        i += 2;
        continue;
      }
      if (next === "-" || next === "_") {
        if (next === "_") emit("-");
        i += 2;
        continue;
      }
      if (next === "\n" || next === "\r") {
        emit("\n");
        i += 2;
        continue;
      }
      const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i + 1, i + 40));
      if (!m) {
        i += 2;
        continue;
      }
      i += 1 + m[0].length;
      const word = m[1]!;
      const arg = m[2] !== undefined ? Number(m[2]) : undefined;
      if (SKIP_DESTINATIONS.has(word)) {
        skip = true;
        continue;
      }
      switch (word) {
        case "par":
        case "line":
        case "sect":
        case "page":
          emit("\n");
          break;
        case "tab":
          emit("\t");
          break;
        case "cell":
          emit("\t");
          break;
        case "row":
          emit("\n");
          break;
        case "emdash":
          emit("—");
          break;
        case "endash":
          emit("–");
          break;
        case "bullet":
          emit("•");
          break;
        case "lquote":
          emit("‘");
          break;
        case "rquote":
          emit("’");
          break;
        case "ldblquote":
          emit("“");
          break;
        case "rdblquote":
          emit("”");
          break;
        case "uc":
          uc = arg ?? 1;
          break;
        case "u":
          if (arg !== undefined) {
            emit(String.fromCharCode(arg < 0 ? arg + 65536 : arg));
            pendingSkip = uc;
          }
          break;
        default:
          break;
      }
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      i += 1;
      continue;
    }
    if (pendingSkip > 0) pendingSkip -= 1;
    else emit(ch);
    i += 1;
  }
  return out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function rtfToPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await FlowPdf.create({ fontSize: 11 });
  for (const paragraph of rtfToText(bytes).split("\n")) {
    pdf.paragraph([{ text: paragraph.replace(/\t/g, "    ") }], { after: 3 });
  }
  return pdf.save();
}
