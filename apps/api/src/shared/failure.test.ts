import sharp from "sharp";
import type { ExecContext, ExecResult, FileRef } from "@onestop/types";
import { describe, expect, it } from "vitest";
import { IMAGE_EXECUTORS } from "../images/index.ts";
import { damagedInputMessage, looksLikeDamagedInput, unexpectedFailureMessage } from "./failure.ts";

describe("looksLikeDamagedInput", () => {
  it.each([
    "Input buffer contains unsupported image format",
    "VipsJpeg: premature end of JPEG file",
    "Can't find end of central directory : is this a zip file ?",
    "Corrupted zip: missing 2843 bytes.",
    "Failed to parse PDF document (line:0 col:0 offset=0): No PDF header found",
    "Invalid or unsupported zip format. No END header found",
    "moov atom not found",
    "Error attempting to read image.",
    "Unexpected end of JSON input",
  ])("recognises a library's complaint about a bad file: %s", (message) => {
    expect(looksLikeDamagedInput(new Error(message))).toBe(true);
  });

  it("does not blame the file for an ordinary bug", () => {
    expect(looksLikeDamagedInput(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(looksLikeDamagedInput(new Error("connect ECONNREFUSED 127.0.0.1:5432"))).toBe(false);
    expect(looksLikeDamagedInput("boom")).toBe(false);
  });

  it("words the two outcomes differently, and neither just says try again", () => {
    expect(damagedInputMessage("PDF")).toMatch(/damaged or incomplete/);
    expect(unexpectedFailureMessage("image")).toMatch(/opens fine elsewhere/);
    expect(damagedInputMessage("PDF")).not.toMatch(/^Please try again/);
  });
});

describe("a damaged file gets an honest message, not 'please try again'", () => {
  const tool = (id: string) => IMAGE_EXECUTORS.find(([k]) => k === id)![1];
  async function run(id: string, name: string, bytes: Uint8Array): Promise<ExecResult> {
    const refs: FileRef[] = [{ name, size: bytes.length, type: "", tempId: "f-0" }];
    const ctx: ExecContext = { jobId: "t", readFile: async () => bytes };
    return tool(id)(refs, {}, ctx);
  }

  it("says a truncated JPEG could not be read, and blames the file", async () => {
    const jpg = await sharp({
      create: { width: 320, height: 240, channels: 3, background: "#1e78c8" },
    })
      .jpeg()
      .toBuffer();
    const result = await run(
      "image-compressor",
      "cut.jpg",
      new Uint8Array(jpg.subarray(0, Math.floor(jpg.length * 0.55))),
    );
    // Either the tool decodes what is there (fine) or it says the file is damaged (fine); what it
    // must never do is fail with a message that asks for a retry.
    if (!result.ok) {
      expect(result.code).toBe("UNSUPPORTED_INPUT");
      expect(result.message).toMatch(/damaged|incomplete|could not be read/i);
      expect(result.message).not.toMatch(/please try again/i);
    }
  });
});
