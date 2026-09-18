// Invisible, selectable text over a page image (06-pdf-tools-advanced.md).
//
// OCR PDF and PDF → PDF/A both need a page that *looks* like an image but whose text can be
// searched, selected and copied. That is text drawn in rendering mode 3 ("invisible"), each word
// stretched horizontally (Tz) so a selection lines up with the word it covers.
import {
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
  type PDFFont,
  type PDFPage,
} from "@cantoo/pdf-lib";
import { drawableText } from "./fonts.ts";

export interface PlacedWord {
  text: string;
  /** Bottom-left corner and size in the page's raw user space (points). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export function drawInvisibleWords(page: PDFPage, font: PDFFont, words: PlacedWord[]): number {
  const usable = words.filter((w) => w.text.trim() !== "" && w.width > 0 && w.height > 0);
  if (usable.length === 0) return 0;
  const key = page.node.newFontDictionary(font.name, font.ref);
  const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
  for (const word of usable) {
    const text = drawableText(font, word.text.trim());
    const size = Math.max(1, word.height);
    const natural = font.widthOfTextAtSize(text, size);
    const squeeze = natural > 0 ? Math.min(1000, Math.max(1, (word.width / natural) * 100)) : 100;
    ops.push(
      setFontAndSize(key, size),
      setCharacterSqueeze(squeeze),
      setTextMatrix(1, 0, 0, 1, word.x, word.y + size * 0.2),
      showText(font.encodeText(text)),
    );
  }
  ops.push(endText(), popGraphicsState());
  page.pushOperators(...ops);
  return usable.length;
}
