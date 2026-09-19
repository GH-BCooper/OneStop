// A real LibreOffice conversion.
//
// Phases 06, 07 and 08 all built on `convertWithLibreOffice` and all recorded the same caveat:
// LibreOffice was never installed on the development machine, so the high-fidelity path and the
// formats only LibreOffice can read (.doc, .xls, .ppt, OpenDocument) were proved through the
// locator seam and nothing else. Phase 19 carried it into its "reduced quality or a prerequisite"
// list. This file is the missing proof, and it skips itself when LibreOffice is not installed -
// which is the supported state, since CLAUDE.md keeps it optional.
import { describe, expect, it } from "vitest";

import { findLibreOffice, convertWithLibreOffice } from "./libreoffice.ts";
import { makeOdt } from "../documents/fixtures.ts";

const describeLive = findLibreOffice() ? describe : describe.skip;

describeLive("live LibreOffice", () => {
  it("is found without LIBREOFFICE_PATH being set by hand", () => {
    // The point of the phase 20 locator change: an install on a drive other than C: still counts.
    expect(findLibreOffice()).toMatch(/soffice(\.exe)?$/i);
  });

  it("converts an OpenDocument file - a format the built-in converter cannot read", async () => {
    const odt = await makeOdt({ paragraphs: ["Quarterly numbers", "Second paragraph"] });
    const docx = await convertWithLibreOffice(odt, "odt", "docx", { timeoutMs: 180_000 });
    // A DOCX is a ZIP: "PK" plus the OOXML part LibreOffice must have written.
    expect(Buffer.from(docx.subarray(0, 2)).toString("latin1")).toBe("PK");
    expect(docx.byteLength).toBeGreaterThan(1000);
  }, 240_000);

  it("converts a document to PDF", async () => {
    const odt = await makeOdt({ paragraphs: ["Hello from LibreOffice"] });
    const pdf = await convertWithLibreOffice(odt, "odt", "pdf", { timeoutMs: 180_000 });
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  }, 240_000);
});
