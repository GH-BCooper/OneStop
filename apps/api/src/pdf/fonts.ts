// Unicode-capable fonts for text the PDF tools draw (06-pdf-tools-advanced.md).
//
// pdf-lib's 14 standard fonts only cover WinAnsi, so "Página 1", "Ω" or "Łódź" would throw. The
// Liberation fonts pdf.js ships in `pdfjs-dist/standard_fonts` (SIL OFL) cover Latin, Greek and
// Cyrillic, are already on disk, and are embedded as subsets so they add only a few KB. Embedded
// fonts are also a PDF/A requirement, which is why PDF → PDF/A and OCR use them too.
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as fontkit from "fontkit";
import { StandardFonts, type PDFDocument, type PDFFont } from "@cantoo/pdf-lib";
import { findPackageDir } from "../shared/node-modules.ts";

export type FontStyle = "regular" | "bold" | "italic" | "bold-italic";

const FILES: Record<FontStyle, string> = {
  regular: "LiberationSans-Regular.ttf",
  bold: "LiberationSans-Bold.ttf",
  italic: "LiberationSans-Italic.ttf",
  "bold-italic": "LiberationSans-BoldItalic.ttf",
};

const STANDARD: Record<FontStyle, StandardFonts> = {
  regular: StandardFonts.Helvetica,
  bold: StandardFonts.HelveticaBold,
  italic: StandardFonts.HelveticaOblique,
  "bold-italic": StandardFonts.HelveticaBoldOblique,
};

const fontBytes = new Map<FontStyle, Promise<Uint8Array | null>>();

async function loadFontBytes(style: FontStyle): Promise<Uint8Array | null> {
  let pending = fontBytes.get(style);
  if (!pending) {
    pending = (async () => {
      const dir = findPackageDir("pdfjs-dist", "standard_fonts");
      if (!dir) return null;
      try {
        return new Uint8Array(await readFile(path.join(dir, "standard_fonts", FILES[style])));
      } catch {
        return null;
      }
    })();
    fontBytes.set(style, pending);
  }
  return pending;
}

/** Embeds a Unicode font (subset). Falls back to Helvetica only if the font files are missing. */
export async function embedUnicodeFont(
  doc: PDFDocument,
  style: FontStyle = "regular",
): Promise<PDFFont> {
  const bytes = await loadFontBytes(style);
  if (!bytes) return doc.embedFont(STANDARD[style]);
  doc.registerFontkit(fontkit);
  return doc.embedFont(bytes, { subset: true });
}

/** Keeps only the characters a font can draw, so drawing never throws on an odd glyph. */
export function drawableText(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}
