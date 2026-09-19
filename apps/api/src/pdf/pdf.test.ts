// Phase 05 test suite (05-pdf-tools-core.md — Test Cases).
//
// Golden-file tests over three generated fixtures (single page, multi-page with mixed sizes, and
// image-heavy), plus every edge case and reject path the build file calls out.
import { getExecutor, getTool } from "@onestop/tool-registry";
import type { ExecContext, ExecResult, FileRef, OutputFile } from "@onestop/types";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "@cantoo/pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadFileCoreConfig, type FileCoreConfig } from "../file-processing/config.ts";
import { createInMemoryJobStore, type JobStore } from "../file-processing/job.ts";
import { runPipeline } from "../file-processing/pipeline.ts";
import { createTempStore, type TempStore } from "../file-processing/tempStore.ts";
import "../file-processing/index.ts";

import { compressPdfExecutor } from "./compress.ts";
import { deletePdfPagesExecutor } from "./deletePages.ts";
import { loadPdf, parsePageOrder, parsePageSelection } from "./document.ts";
import { extractPdfPagesExecutor } from "./extractPages.ts";
import {
  makeCorruptPdf,
  makeEncryptedPdf,
  makeImageHeavyPdf,
  makeSinglePagePdf,
  makeTextPdf,
} from "./fixtures.ts";
import { mergePdfExecutor } from "./merge.ts";
import { reorderPdfPagesExecutor } from "./reorderPages.ts";
import { repairPdfExecutor } from "./repair.ts";
import { resizePdfExecutor } from "./resize.ts";
import { rotatePdfPagesExecutor } from "./rotate.ts";
import { splitPdfExecutor } from "./split.ts";
import { pdfToImagesExecutor } from "./toImages.ts";
import { pdfToTextExecutor } from "./toText.ts";
import { PDF_CORE_EXECUTORS } from "./index.ts";
import { createZip, crc32 } from "./zip.ts";
import { recordOfflineCoverage } from "../../../../tests/offline/coverage.ts";

// ---- helpers ----------------------------------------------------------------------------------

/** Builds the (files, ctx) pair an executor expects, without touching the filesystem. */
function inputs(files: { name: string; bytes: Uint8Array }[]): {
  refs: FileRef[];
  ctx: ExecContext;
} {
  const refs: FileRef[] = files.map((f, i) => ({
    name: f.name,
    size: f.bytes.length,
    type: "application/pdf",
    tempId: `fixture-${i}`,
  }));
  const byId = new Map(refs.map((ref, i) => [ref.tempId!, files[i]!.bytes]));
  return {
    refs,
    ctx: {
      jobId: "test-job",
      readFile: async (file) => {
        const bytes = byId.get(file.tempId ?? "");
        if (!bytes) throw new Error("unknown temp id");
        return bytes;
      },
    },
  };
}

function expectOk(result: ExecResult): Extract<ExecResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected success, got ${result.code}: ${result.message}`);
  return result;
}

function expectFail(result: ExecResult): Extract<ExecResult, { ok: false }> {
  if (result.ok) throw new Error("expected a failure, got a success");
  return result;
}

function only(result: ExecResult): OutputFile {
  const ok = expectOk(result);
  expect(ok.files).toBeDefined();
  expect(ok.files!.length).toBe(1);
  return ok.files![0]!;
}

/** A result PDF must be a real PDF: parse it and count the pages. */
async function pageCountOf(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

let multiPage: Uint8Array;
let mixedSizes: Uint8Array;
let singlePage: Uint8Array;
let imageHeavy: Uint8Array;

beforeAll(async () => {
  multiPage = await makeTextPdf({ pages: 5 });
  mixedSizes = await makeTextPdf({
    pages: 3,
    sizes: [
      [595.28, 841.89],
      [612, 792],
      [841.89, 595.28],
    ],
  });
  singlePage = await makeSinglePagePdf();
  imageHeavy = await makeImageHeavyPdf(2);
}, 60_000);

// ---- registry contract -------------------------------------------------------------------------

describe("registry", () => {
  it("registers a real executor for every phase-05 tool and marks it available", () => {
    for (const [id] of PDF_CORE_EXECUTORS) {
      const tool = getTool(id);
      expect(tool, `missing registry entry for ${id}`).toBeDefined();
      expect(tool!.phase).toBe("05");
      expect(tool!.status).toBe("available");
      expect(tool!.execution).toBe("local");
      expect(tool!.network).toBe("none");
      // The executor the pipeline would pick must not be the phase-03 stub.
      const executor = getExecutor(tool!);
      expect(executor).toBe(PDF_CORE_EXECUTORS.find(([x]) => x === id)![1]);
    }
  });

  it("covers every tool the build file lists", () => {
    expect(PDF_CORE_EXECUTORS.map(([id]) => id).sort()).toEqual(
      [
        "compress-pdf",
        "delete-pdf-pages",
        "extract-pdf-pages",
        "merge-pdf",
        "pdf-to-images",
        "pdf-to-text",
        "reorder-pdf-pages",
        "repair-pdf",
        "resize-pdf",
        "rotate-pdf-pages",
        "split-pdf",
      ].sort(),
    );
  });
});

// ---- page selection -----------------------------------------------------------------------------

describe("page selection", () => {
  it("parses ranges, lists, keywords and open-ended ranges", () => {
    expect(parsePageSelection("", 4)).toEqual([1, 2, 3, 4]);
    expect(parsePageSelection("all", 3)).toEqual([1, 2, 3]);
    expect(parsePageSelection("1-3", 5)).toEqual([1, 2, 3]);
    expect(parsePageSelection("1,3, 5", 5)).toEqual([1, 3, 5]);
    expect(parsePageSelection("3-", 5)).toEqual([3, 4, 5]);
    expect(parsePageSelection("odd", 5)).toEqual([1, 3, 5]);
    expect(parsePageSelection("even", 5)).toEqual([2, 4]);
    expect(parsePageSelection("first,last", 5)).toEqual([1, 5]);
    expect(parsePageSelection("2,2,2", 5)).toEqual([2]);
  });

  it("rejects out-of-range and nonsense selections with an actionable message", () => {
    expect(() => parsePageSelection("9", 3)).toThrow(/only|3 pages/i);
    expect(() => parsePageSelection("0", 3)).toThrow(/does not exist/);
    expect(() => parsePageSelection("3-1", 3)).toThrow(/not a valid page range/);
    expect(() => parsePageSelection("abc", 3)).toThrow(/not a page number/);
    expect(() => parsePageSelection("2", 1)).toThrow(/only 1 page/);
  });

  it("keeps pages left out of an explicit order", () => {
    expect(parsePageOrder("3,1", 4)).toEqual([3, 1, 2, 4]);
    expect(parsePageOrder("reverse", 3)).toEqual([3, 2, 1]);
    expect(parsePageOrder("1-3", 3)).toEqual([1, 2, 3]);
    expect(parsePageOrder("3-1", 3)).toEqual([3, 2, 1]);
  });
});

// ---- merge ---------------------------------------------------------------------------------------

describe("merge-pdf", () => {
  it("merges PDFs of different page sizes without crashing", async () => {
    const { refs, ctx } = inputs([
      { name: "a.pdf", bytes: multiPage },
      { name: "b.pdf", bytes: mixedSizes },
      { name: "c.pdf", bytes: singlePage },
    ]);
    const file = only(await mergePdfExecutor(refs, {}, ctx));
    expect(file.name).toBe("a-merged.pdf");
    expect(await pageCountOf(file.bytes)).toBe(9);

    const doc = await PDFDocument.load(file.bytes);
    // Page 7 came from the mixed-size fixture's landscape page.
    const landscape = doc.getPage(7).getSize();
    expect(landscape.width).toBeGreaterThan(landscape.height);
  });

  it("sorts by file name when asked", async () => {
    const { refs, ctx } = inputs([
      { name: "b.pdf", bytes: singlePage },
      { name: "a.pdf", bytes: multiPage },
    ]);
    const file = only(await mergePdfExecutor(refs, { order: "name" }, ctx));
    expect(file.name).toBe("a-merged.pdf");
    expect(await pageCountOf(file.bytes)).toBe(6);
  });

  it("asks for a second file rather than silently copying one", async () => {
    const { refs, ctx } = inputs([{ name: "a.pdf", bytes: multiPage }]);
    const result = expectFail(await mergePdfExecutor(refs, {}, ctx));
    expect(result.code).toBe("UNSUPPORTED_INPUT");
    expect(result.message).toMatch(/at least two/i);
  });
});

// ---- split ----------------------------------------------------------------------------------------

describe("split-pdf", () => {
  it("splits into single pages and packs them into one ZIP", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: multiPage }]);
    const file = only(await splitPdfExecutor(refs, { mode: "each-page" }, ctx));
    expect(file.name).toBe("doc-split.zip");
    expect(file.mimeType).toBe("application/zip");
    expect([...file.bytes.subarray(0, 2)]).toEqual([0x50, 0x4b]);
  });

  it("returns separate PDFs when asked", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: multiPage }]);
    const ok = expectOk(
      await splitPdfExecutor(refs, { mode: "each-page", packaging: "files" }, ctx),
    );
    expect(ok.files).toHaveLength(5);
    for (const part of ok.files!) expect(await pageCountOf(part.bytes)).toBe(1);
    expect(ok.files!.map((f) => f.name)).toEqual([
      "doc-part-1.pdf",
      "doc-part-2.pdf",
      "doc-part-3.pdf",
      "doc-part-4.pdf",
      "doc-part-5.pdf",
    ]);
  });

  it("splits every N pages", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: multiPage }]);
    const ok = expectOk(
      await splitPdfExecutor(refs, { mode: "every-n", size: 2, packaging: "files" }, ctx),
    );
    expect(ok.files).toHaveLength(3);
    expect(await pageCountOf(ok.files![0]!.bytes)).toBe(2);
    expect(await pageCountOf(ok.files![2]!.bytes)).toBe(1);
  });

  it("splits by explicit ranges", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: multiPage }]);
    const ok = expectOk(
      await splitPdfExecutor(refs, { mode: "ranges", ranges: "1-2, 4-5", packaging: "files" }, ctx),
    );
    expect(ok.files).toHaveLength(2);
    expect(await pageCountOf(ok.files![0]!.bytes)).toBe(2);
  });

  it("handles a single-page PDF by saying there was nothing to split", async () => {
    const { refs, ctx } = inputs([{ name: "one.pdf", bytes: singlePage }]);
    const ok = expectOk(await splitPdfExecutor(refs, { mode: "each-page" }, ctx));
    expect(ok.summary).toMatch(/single page/i);
    expect(await pageCountOf(ok.files![0]!.bytes)).toBe(1);
  });

  it("rejects an out-of-range range", async () => {
    const { refs, ctx } = inputs([{ name: "one.pdf", bytes: singlePage }]);
    const result = expectFail(await splitPdfExecutor(refs, { mode: "ranges", ranges: "1-4" }, ctx));
    expect(result.message).toMatch(/only 1 page/i);
  });
});

// ---- extract / delete / reorder / rotate -------------------------------------------------------

describe("extract-pdf-pages", () => {
  it("copies the selected pages", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: multiPage }]);
    const file = only(await extractPdfPagesExecutor(refs, { pages: "2,4" }, ctx));
    expect(file.name).toBe("doc-pages.pdf");
    expect(await pageCountOf(file.bytes)).toBe(2);
  });

  it("works on a single-page PDF", async () => {
    const { refs, ctx } = inputs([{ name: "one.pdf", bytes: singlePage }]);
    const file = only(await extractPdfPagesExecutor(refs, { pages: "1" }, ctx));
    expect(await pageCountOf(file.bytes)).toBe(1);
  });

  it("reports an out-of-range page clearly instead of crashing", async () => {
    const { refs, ctx } = inputs([{ name: "one.pdf", bytes: singlePage }]);
    const result = expectFail(await extractPdfPagesExecutor(refs, { pages: "2" }, ctx));
    expect(result.code).toBe("UNSUPPORTED_INPUT");
    expect(result.message).toMatch(/only 1 page/i);
  });
});

describe("delete-pdf-pages", () => {
  it("removes the selected pages", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: multiPage }]);
    const file = only(await deletePdfPagesExecutor(refs, { pages: "2-3" }, ctx));
    expect(file.name).toBe("doc-trimmed.pdf");
    expect(await pageCountOf(file.bytes)).toBe(3);
  });

  it("refuses to delete every page", async () => {
    const { refs, ctx } = inputs([{ name: "one.pdf", bytes: singlePage }]);
    const result = expectFail(await deletePdfPagesExecutor(refs, { pages: "1" }, ctx));
    expect(result.message).toMatch(/at least one page/i);
  });

  it("asks which pages to delete when none are given", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: multiPage }]);
    const result = expectFail(await deletePdfPagesExecutor(refs, {}, ctx));
    expect(result.message).toMatch(/pages to delete/i);
  });
});

describe("reorder-pdf-pages", () => {
  it("applies an explicit order and keeps the pages it was not told about", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: multiPage }]);
    const file = only(await reorderPdfPagesExecutor(refs, { order: "5,1" }, ctx));
    expect(await pageCountOf(file.bytes)).toBe(5);
  });

  it("reverses with the preset", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: multiPage }]);
    const ok = expectOk(await reorderPdfPagesExecutor(refs, { preset: "reverse" }, ctx));
    expect((ok.output as { order: number[] }).order).toEqual([5, 4, 3, 2, 1]);
  });

  it("handles a single-page PDF", async () => {
    const { refs, ctx } = inputs([{ name: "one.pdf", bytes: singlePage }]);
    const ok = expectOk(await reorderPdfPagesExecutor(refs, { order: "1" }, ctx));
    expect(ok.summary).toMatch(/single page/i);
  });

  it("rejects an out-of-range page number", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: multiPage }]);
    const result = expectFail(await reorderPdfPagesExecutor(refs, { order: "9,1" }, ctx));
    expect(result.message).toMatch(/does not exist/i);
  });
});

describe("rotate-pdf-pages", () => {
  it("rotates the selected pages and leaves the rest alone", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: multiPage }]);
    const file = only(await rotatePdfPagesExecutor(refs, { angle: "90", pages: "1,2" }, ctx));
    const doc = await PDFDocument.load(file.bytes);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
    expect(doc.getPage(2).getRotation().angle).toBe(0);
  });

  it("adds to an existing rotation", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: multiPage }]);
    const once = only(await rotatePdfPagesExecutor(refs, { angle: 270 }, ctx));
    const second = inputs([{ name: "doc.pdf", bytes: once.bytes }]);
    const twice = only(await rotatePdfPagesExecutor(second.refs, { angle: 180 }, second.ctx));
    const doc = await PDFDocument.load(twice.bytes);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
  });

  it("rejects an angle that is not a quarter turn", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: multiPage }]);
    const result = expectFail(await rotatePdfPagesExecutor(refs, { angle: 45 }, ctx));
    expect(result.message).toMatch(/90, 180 or 270/);
  });
});

// ---- resize ----------------------------------------------------------------------------------

describe("resize-pdf", () => {
  it("puts every page onto the chosen size", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: mixedSizes }]);
    const file = only(
      await resizePdfExecutor(refs, { size: "letter", orientation: "portrait" }, ctx),
    );
    const doc = await PDFDocument.load(file.bytes);
    expect(doc.getPageCount()).toBe(3);
    for (const page of doc.getPages()) {
      expect(Math.round(page.getWidth())).toBe(612);
      expect(Math.round(page.getHeight())).toBe(792);
    }
  });

  it("follows each page's own orientation on auto", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: mixedSizes }]);
    const file = only(await resizePdfExecutor(refs, { size: "a4", orientation: "auto" }, ctx));
    const doc = await PDFDocument.load(file.bytes);
    expect(doc.getPage(2).getWidth()).toBeGreaterThan(doc.getPage(2).getHeight());
    expect(doc.getPage(0).getWidth()).toBeLessThan(doc.getPage(0).getHeight());
  });
});

// ---- compress --------------------------------------------------------------------------------

describe("compress-pdf", () => {
  it("meaningfully reduces the size of an image-heavy PDF", async () => {
    const { refs, ctx } = inputs([{ name: "scan.pdf", bytes: imageHeavy }]);
    const ok = expectOk(await compressPdfExecutor(refs, { level: "strong" }, ctx));
    const out = ok.files![0]!;
    expect(out.bytes.length).toBeLessThan(imageHeavy.length * 0.7);
    expect(await pageCountOf(out.bytes)).toBe(2);
    expect((ok.output as { percent: number }).percent).toBeGreaterThan(30);
  }, 60_000);

  it("keeps text selectable at the light level", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: multiPage }]);
    const ok = expectOk(await compressPdfExecutor(refs, { level: "light" }, ctx));
    expect((ok.output as { results: { method: string }[] }).results[0]!.method).not.toBe(
      "rasterised",
    );
    await expect(pageCountOf(ok.files![0]!.bytes)).resolves.toBe(5);
  });

  it("never hands back something larger than the original", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: multiPage }]);
    const ok = expectOk(await compressPdfExecutor(refs, { level: "balanced" }, ctx));
    expect(ok.files![0]!.bytes.length).toBeLessThanOrEqual(multiPage.length);
  }, 60_000);

  it("compresses a batch", async () => {
    const { refs, ctx } = inputs([
      { name: "a.pdf", bytes: multiPage },
      { name: "b.pdf", bytes: singlePage },
    ]);
    const ok = expectOk(await compressPdfExecutor(refs, { level: "light" }, ctx));
    expect(ok.files).toHaveLength(2);
    expect(ok.files!.map((f) => f.name)).toEqual(["a-compressed.pdf", "b-compressed.pdf"]);
  });
});

// ---- rendering and text ----------------------------------------------------------------------

describe("pdf-to-images", () => {
  it("renders every page as a PNG", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: mixedSizes }]);
    const ok = expectOk(
      await pdfToImagesExecutor(refs, { format: "png", dpi: 72, packaging: "files" }, ctx),
    );
    expect(ok.files).toHaveLength(3);
    for (const file of ok.files!) {
      expect(file.mimeType).toBe("image/png");
      expect([...file.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
    expect(ok.files![0]!.name).toBe("doc-page-01.png");
  }, 60_000);

  it("renders a page selection as JPG into a ZIP", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: multiPage }]);
    const file = only(
      await pdfToImagesExecutor(refs, { format: "jpg", dpi: 72, pages: "1,3" }, ctx),
    );
    expect(file.name).toBe("doc-images.zip");
    expect(file.mimeType).toBe("application/zip");
  }, 60_000);

  it("renders a single-page PDF as one image, not an archive", async () => {
    const { refs, ctx } = inputs([{ name: "one.pdf", bytes: singlePage }]);
    const file = only(await pdfToImagesExecutor(refs, { dpi: 72 }, ctx));
    expect(file.mimeType).toBe("image/png");
  }, 60_000);
});

describe("pdf-to-text", () => {
  it("extracts the text of every page with page markers", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: multiPage }]);
    const file = only(await pdfToTextExecutor(refs, {}, ctx));
    const text = new TextDecoder().decode(file.bytes);
    expect(file.name).toBe("doc.txt");
    expect(text).toContain("--- Page 1 ---");
    expect(text).toContain("Page 1 of 5");
    expect(text).toContain("Page 5 of 5");
  }, 60_000);

  it("can return continuous text for a page range", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: multiPage }]);
    const ok = expectOk(await pdfToTextExecutor(refs, { layout: "plain", pages: "2" }, ctx));
    const text = new TextDecoder().decode(ok.files![0]!.bytes);
    expect(text).not.toContain("--- Page");
    expect(text).toContain("Page 2 of 5");
  }, 60_000);

  it("points at OCR when the PDF has no text layer", async () => {
    const { refs, ctx } = inputs([{ name: "scan.pdf", bytes: imageHeavy }]);
    const result = expectFail(await pdfToTextExecutor(refs, {}, ctx));
    expect(result.message).toMatch(/OCR PDF/);
  }, 60_000);
});

// ---- protected and damaged files ---------------------------------------------------------------

describe("password-protected input", () => {
  const encrypted = makeEncryptedPdf();

  it.each([
    ["merge-pdf", mergePdfExecutor],
    ["split-pdf", splitPdfExecutor],
    ["extract-pdf-pages", extractPdfPagesExecutor],
    ["rotate-pdf-pages", rotatePdfPagesExecutor],
    ["compress-pdf", compressPdfExecutor],
    ["resize-pdf", resizePdfExecutor],
    ["pdf-to-text", pdfToTextExecutor],
    ["repair-pdf", repairPdfExecutor],
  ])(
    "%s says the PDF is protected rather than failing silently",
    async (_id, executor) => {
      const { refs, ctx } = inputs([
        { name: "locked.pdf", bytes: encrypted },
        { name: "locked-2.pdf", bytes: encrypted },
      ]);
      const result = expectFail(await executor(refs, {}, ctx));
      expect(result.code).toBe("UNSUPPORTED_INPUT");
      expect(result.message).toMatch(/password protected/i);
    },
    60_000,
  );
});

describe("repair-pdf", () => {
  it("rewrites a healthy PDF cleanly", async () => {
    const { refs, ctx } = inputs([{ name: "doc.pdf", bytes: multiPage }]);
    const ok = expectOk(await repairPdfExecutor(refs, {}, ctx));
    expect((ok.output as { method: string }).method).toBe("already-valid");
    expect(await pageCountOf(ok.files![0]!.bytes)).toBe(5);
  });

  it("recovers a PDF with a broken cross-reference table", async () => {
    const broken = await makeCorruptPdf("bad-xref");
    const { refs, ctx } = inputs([{ name: "broken.pdf", bytes: broken }]);
    const ok = expectOk(await repairPdfExecutor(refs, {}, ctx));
    expect(await pageCountOf(ok.files![0]!.bytes)).toBeGreaterThan(0);
  }, 60_000);

  it("recovers a PDF with junk after the end of the document", async () => {
    const broken = await makeCorruptPdf("trailing-junk");
    const { refs, ctx } = inputs([{ name: "broken.pdf", bytes: broken }]);
    const ok = expectOk(await repairPdfExecutor(refs, {}, ctx));
    expect(await pageCountOf(ok.files![0]!.bytes)).toBe(2);
  }, 60_000);

  it("recovers a PDF with junk before the header", async () => {
    const broken = await makeCorruptPdf("leading-junk");
    const { refs, ctx } = inputs([{ name: "broken.pdf", bytes: broken }]);
    const ok = expectOk(await repairPdfExecutor(refs, {}, ctx));
    expect((ok.output as { method: string }).method).toBe("salvaged");
    expect(await pageCountOf(ok.files![0]!.bytes)).toBe(2);
  }, 60_000);

  it("gives a clear message when a file is beyond recovery", async () => {
    const { refs, ctx } = inputs([
      { name: "junk.pdf", bytes: new TextEncoder().encode("%PDF-1.7\nnot a pdf at all\n") },
    ]);
    const result = expectFail(await repairPdfExecutor(refs, {}, ctx));
    expect(result.code).toBe("UNSUPPORTED_INPUT");
    expect(result.message).toMatch(/too damaged|could not be read/i);
  }, 60_000);
});

describe("damaged input in the other tools", () => {
  it("points at Repair PDF instead of failing obscurely", async () => {
    const { refs, ctx } = inputs([
      { name: "junk.pdf", bytes: new TextEncoder().encode("%PDF-1.7\nnot a pdf at all\n") },
    ]);
    const result = expectFail(await extractPdfPagesExecutor(refs, {}, ctx));
    expect(result.code).toBe("UNSUPPORTED_INPUT");
    expect(result.message).toMatch(/Repair PDF/);
  });

  it("refuses an empty PDF with no pages", async () => {
    const empty = await (await PDFDocument.create()).save({ addDefaultPage: false });
    const { refs, ctx } = inputs([{ name: "empty.pdf", bytes: empty }]);
    const result = expectFail(await extractPdfPagesExecutor(refs, {}, ctx));
    expect(result.message).toMatch(/no pages/i);
  });
});

// ---- zip writer ---------------------------------------------------------------------------------

describe("zip writer", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("writes a readable archive with unique entry names", () => {
    const zip = createZip([
      { name: "a.pdf", bytes: new Uint8Array([1, 2, 3]) },
      { name: "../../a.pdf", bytes: new Uint8Array([4, 5, 6]) },
    ]);
    const text = new TextDecoder("latin1").decode(zip);
    expect([...zip.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(text).toContain("a.pdf");
    expect(text).toContain("a-2.pdf");
    expect(text).not.toContain("..");
  });
});

// ---- end to end through the pipeline ------------------------------------------------------------

describe("through the phase-04 pipeline", () => {
  let dir: string;
  let temp: TempStore;
  let jobs: JobStore;
  let config: FileCoreConfig;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "onestop-pdf-test-"));
    temp = createTempStore({ tempDir: dir, ttlMs: 60_000, autoSweep: false });
    jobs = createInMemoryJobStore();
    config = { ...loadFileCoreConfig(), tempDir: dir, maxUploadBytes: 50 * 1024 * 1024 };
  });

  afterAll(async () => {
    await temp.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("runs Merge PDF end to end and offers a downloadable result", async () => {
    const outcome = await runPipeline(
      {
        toolId: "merge-pdf",
        files: [
          { name: "one.pdf", mimeType: "application/pdf", bytes: multiPage },
          { name: "two.pdf", mimeType: "application/pdf", bytes: singlePage },
        ],
      },
      { jobs, temp, config },
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.job.status).toBe("success");
    expect(outcome.files).toHaveLength(1);
    expect(outcome.files[0]!.mimeType).toBe("application/pdf");
    expect(outcome.files[0]!.url).toMatch(/^\/api\/files\//);
    expect(await pageCountOf(await temp.read(outcome.files[0]!.id))).toBe(6);
  }, 60_000);

  it("passes options through to the executor", async () => {
    const outcome = await runPipeline(
      {
        toolId: "rotate-pdf-pages",
        files: [{ name: "doc.pdf", mimeType: "application/pdf", bytes: multiPage }],
        options: { angle: "180", pages: "1" },
      },
      { jobs, temp, config },
    );
    expect(outcome.ok).toBe(true);
    const doc = await PDFDocument.load(await temp.read(outcome.files[0]!.id));
    expect(doc.getPage(0).getRotation().angle).toBe(180);
  }, 60_000);

  it("rejects a non-PDF upload before the tool ever sees it", async () => {
    const outcome = await runPipeline(
      {
        toolId: "split-pdf",
        files: [
          { name: "notes.txt", mimeType: "text/plain", bytes: new TextEncoder().encode("hello") },
        ],
      },
      { jobs, temp, config },
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBe("UNSUPPORTED_INPUT");
    expect(outcome.job.status).toBe("failed");
  });

  it("rejects a .pdf whose bytes are not a PDF", async () => {
    const outcome = await runPipeline(
      {
        toolId: "split-pdf",
        files: [
          {
            name: "fake.pdf",
            mimeType: "application/pdf",
            bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
          },
        ],
      },
      { jobs, temp, config },
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.message).toMatch(/not supported/i);
  });

  it("reports a protected PDF through the job record", async () => {
    const outcome = await runPipeline(
      {
        toolId: "compress-pdf",
        files: [{ name: "locked.pdf", mimeType: "application/pdf", bytes: makeEncryptedPdf() }],
      },
      { jobs, temp, config },
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.message).toMatch(/password protected/i);
    expect(outcome.job.outputMetadata).toMatchObject({ code: "UNSUPPORTED_INPUT" });
  });
});

// ---- sanity: the fixtures themselves --------------------------------------------------------

describe("fixtures", () => {
  it("builds documents the tools can open", async () => {
    expect((await loadPdf(multiPage)).getPageCount()).toBe(5);
    expect((await loadPdf(singlePage)).getPageCount()).toBe(1);
    expect(imageHeavy.length).toBeGreaterThan(100_000);
  });
});

// ---- offline ----------------------------------------------------------------------------------

describe("offline", () => {
  it("makes no network call, even for the pdf.js fonts and CMaps", async () => {
    const calls: string[] = [];
    const trap = (label: string) =>
      ((...args: unknown[]) => {
        calls.push(`${label}(${String(args[0])})`);
        throw new Error(`${label} must not be called offline`);
      }) as never;

    const http = await import("node:http");
    const https = await import("node:https");
    const realFetch = globalThis.fetch;
    const realHttpGet = http.default.get;
    const realHttpsGet = https.default.get;
    const realHttpRequest = http.default.request;
    const realHttpsRequest = https.default.request;
    globalThis.fetch = trap("fetch");
    http.default.get = trap("http.get");
    https.default.get = trap("https.get");
    http.default.request = trap("http.request");
    https.default.request = trap("https.request");

    try {
      for (const [, executor] of PDF_CORE_EXECUTORS) {
        const { refs, ctx } = inputs([
          { name: "a.pdf", bytes: multiPage },
          { name: "b.pdf", bytes: singlePage },
        ]);
        const result = await executor(
          refs,
          { dpi: 72, level: "balanced", pages: "1", preset: "reverse", angle: "90" },
          ctx,
        );
        expect(result.ok, `a tool failed with the network disabled`).toBe(true);
      }
    } finally {
      globalThis.fetch = realFetch;
      http.default.get = realHttpGet;
      https.default.get = realHttpsGet;
      http.default.request = realHttpRequest;
      https.default.request = realHttpsRequest;
    }
    expect(calls).toEqual([]);
    recordOfflineCoverage("pdf-core", PDF_CORE_EXECUTORS.map(([id]) => id));
  }, 120_000);
});
