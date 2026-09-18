// PowerPoint tools (Features 5.4–5.10) — 07-word-ppt-tools.md. PowerPoint → PDF / Images live in
// convert.ts, Compress Presentation in compress.ts; the slide surgery itself is in slides.ts.
import type { Executor } from "@onestop/tool-registry";
import type { OutputFile } from "@onestop/types";
import { packageOutputs } from "../pdf/inputs.ts";
import {
  baseName,
  ensureOoxml,
  MIME,
  optBool,
  optEnum,
  optNumber,
  optString,
  parseOrder,
  parseSelection,
  plural,
  readDocInputs,
  readSingleDoc,
  runDocTool,
  textFile,
  unsupported,
  type DocInput,
} from "./common.ts";
import { keepSlides, mergeDecks, openDeck, slideTexts, type Deck } from "./slides.ts";

export const POWERPOINT_TO_TEXT_TOOL_ID = "powerpoint-to-text";
export const MERGE_PRESENTATIONS_TOOL_ID = "merge-presentations";
export const SPLIT_PRESENTATION_TOOL_ID = "split-presentation";
export const EXTRACT_SLIDES_TOOL_ID = "extract-slides";
export const REARRANGE_SLIDES_TOOL_ID = "rearrange-slides";
export const REMOVE_SLIDES_TOOL_ID = "remove-slides";

async function pptxOf(file: DocInput, signal?: AbortSignal): Promise<Uint8Array> {
  return (await ensureOoxml(file, "pptx", signal)).bytes;
}

async function deckOf(file: DocInput, signal?: AbortSignal): Promise<Deck> {
  const deck = await openDeck(await pptxOf(file, signal));
  if (deck.slides.length === 0) throw unsupported("This presentation has no slides.");
  return deck;
}

function pptxFile(name: string, bytes: Uint8Array): OutputFile {
  return { name, mimeType: MIME.pptx, bytes };
}

// ---- PowerPoint → Text ------------------------------------------------------------------------

export const powerPointToTextExecutor: Executor = async (input, options, ctx) =>
  runDocTool(POWERPOINT_TO_TEXT_TOOL_ID, async () => {
    const file = await readSingleDoc(input, ctx, "presentation");
    const deck = await deckOf(file, ctx?.signal);
    const notes = optBool(options, "notes", true);
    const slides = await slideTexts(deck);
    const blocks = slides.map((s) => {
      const lines = [`--- Slide ${s.slide} ---`, ...s.text];
      if (notes && s.notes.length > 0) lines.push("", "Notes:", ...s.notes);
      return lines.join("\n");
    });
    const words = slides
      .flatMap((s) => [...s.text, ...(notes ? s.notes : [])])
      .join(" ")
      .split(/\s+/)
      .filter(Boolean).length;
    if (words === 0) throw unsupported("No text was found on these slides.");
    return {
      ok: true,
      output: { slides: slides.length, words, preview: blocks.slice(0, 3).join("\n\n") },
      summary: `Extracted ${plural(words, "word")} from ${plural(slides.length, "slide")}${notes ? " (with speaker notes)" : ""}.`,
      files: [textFile(`${baseName(file.ref.name)}.txt`, `${blocks.join("\n\n")}\n`)],
    };
  });

// ---- Merge ------------------------------------------------------------------------------------

export const mergePresentationsExecutor: Executor = async (input, _options, ctx) =>
  runDocTool(MERGE_PRESENTATIONS_TOOL_ID, async () => {
    const files = await readDocInputs(input, ctx, { min: 2, what: "presentation" });
    const decks: Uint8Array[] = [];
    for (const file of files) decks.push(await pptxOf(file, ctx?.signal));
    const base = await openDeck(decks[0]!);
    const { bytes, sizeMismatch } = await mergeDecks(base, decks.slice(1));
    return {
      ok: true,
      output: { presentations: files.length, slides: base.slides.length },
      summary: `Merged ${plural(files.length, "presentation")} into one deck of ${plural(base.slides.length, "slide")}.${sizeMismatch ? " The decks had different slide sizes; the first deck's size is used." : ""}`,
      files: [pptxFile(`${baseName(files[0]!.ref.name)}-merged.pptx`, bytes)],
    };
  });

// ---- Split ------------------------------------------------------------------------------------

/** "1-3, 4-6, 7-" → [[1,2,3],[4,5,6],[7..n]]. Ranges may not overlap. */
export function parseRanges(spec: string, count: number): number[][] {
  const groups = spec
    .split(/[;,]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => parseSelection(p, count));
  const seen = new Set<number>();
  for (const g of groups) {
    for (const n of g) {
      if (seen.has(n)) throw unsupported(`Slide ${n} is in more than one range.`);
      seen.add(n);
    }
  }
  return groups;
}

export const splitPresentationExecutor: Executor = async (input, options, ctx) =>
  runDocTool(SPLIT_PRESENTATION_TOOL_ID, async () => {
    const file = await readSingleDoc(input, ctx, "presentation");
    const bytes = await pptxOf(file, ctx?.signal);
    const count = (await openDeck(bytes)).slides.length;
    if (count === 0) throw unsupported("This presentation has no slides.");
    const mode = optEnum(options, "mode", ["every", "ranges"] as const, "every");
    let groups: number[][];
    if (mode === "ranges") {
      const spec = optString(options, "ranges").trim();
      if (spec === "") throw unsupported("Enter the ranges to split into, for example 1-3, 4-6.");
      groups = parseRanges(spec, count);
    } else {
      const size = optNumber(options, "size", 1, { min: 1, max: 500 });
      groups = [];
      for (let start = 1; start <= count; start += size) {
        groups.push(Array.from({ length: Math.min(size, count - start + 1) }, (_, i) => start + i));
      }
    }
    if (groups.length < 2) {
      throw unsupported(
        count === 1
          ? "This presentation has only 1 slide, so there is nothing to split."
          : "That would give just one presentation. Choose fewer slides per file or more ranges.",
      );
    }
    const stem = baseName(file.ref.name);
    const outputs: OutputFile[] = [];
    for (const group of groups) {
      const deck = await openDeck(bytes);
      const label =
        group.length === 1 ? `slide-${group[0]}` : `slides-${group[0]}-${group[group.length - 1]}`;
      outputs.push(pptxFile(`${stem}-${label}.pptx`, await keepSlides(deck, group)));
    }
    const packaging = optEnum(options, "packaging", ["zip", "files"] as const, "zip");
    return {
      ok: true,
      output: { parts: groups.map((g) => g.join(",")) },
      summary: `Split ${plural(count, "slide")} into ${plural(groups.length, "presentation")}.`,
      files: packageOutputs(outputs, `${stem}-split.zip`, packaging),
    };
  });

// ---- Extract / Rearrange / Remove -------------------------------------------------------------

export const extractSlidesExecutor: Executor = async (input, options, ctx) =>
  runDocTool(EXTRACT_SLIDES_TOOL_ID, async () => {
    const file = await readSingleDoc(input, ctx, "presentation");
    const deck = await deckOf(file, ctx?.signal);
    const spec = optString(options, "slides").trim();
    if (spec === "") throw unsupported("Enter the slides to extract, for example 2-4, 7.");
    const picked = parseSelection(spec, deck.slides.length);
    const bytes = await keepSlides(deck, picked);
    return {
      ok: true,
      output: { slides: picked, count: picked.length },
      summary: `Extracted ${plural(picked.length, "slide")} into a new presentation, renumbered 1–${picked.length}.`,
      files: [pptxFile(`${baseName(file.ref.name)}-extracted.pptx`, bytes)],
    };
  });

export const rearrangeSlidesExecutor: Executor = async (input, options, ctx) =>
  runDocTool(REARRANGE_SLIDES_TOOL_ID, async () => {
    const file = await readSingleDoc(input, ctx, "presentation");
    const deck = await deckOf(file, ctx?.signal);
    const order = parseOrder(optString(options, "order"), deck.slides.length);
    const bytes = await keepSlides(deck, order);
    return {
      ok: true,
      output: { order },
      summary: `Rearranged ${plural(order.length, "slide")}: new order ${order.join(", ")}.`,
      files: [pptxFile(`${baseName(file.ref.name)}-rearranged.pptx`, bytes)],
    };
  });

export const removeSlidesExecutor: Executor = async (input, options, ctx) =>
  runDocTool(REMOVE_SLIDES_TOOL_ID, async () => {
    const file = await readSingleDoc(input, ctx, "presentation");
    const deck = await deckOf(file, ctx?.signal);
    const spec = optString(options, "slides").trim();
    if (spec === "") throw unsupported("Enter the slides to remove, for example 2, 5-6.");
    const drop = new Set(parseSelection(spec, deck.slides.length));
    const keep = deck.slides.map((_, i) => i + 1).filter((n) => !drop.has(n));
    if (keep.length === 0) throw unsupported("You can't remove every slide — keep at least one.");
    const bytes = await keepSlides(deck, keep);
    return {
      ok: true,
      output: { removed: [...drop], remaining: keep.length },
      summary: `Removed ${plural(drop.size, "slide")}; ${plural(keep.length, "slide")} remain, renumbered 1–${keep.length}.`,
      files: [pptxFile(`${baseName(file.ref.name)}-edited.pptx`, bytes)],
    };
  });
