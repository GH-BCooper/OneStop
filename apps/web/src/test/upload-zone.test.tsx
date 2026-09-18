// @vitest-environment jsdom
import { getTool } from "@onestop/tool-registry";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { checkFiles, formatBytes, UploadZone } from "@/components/tools/UploadZone";

const mergePdf = getTool("merge-pdf")!;
// A single-file tool that accepts PDFs (phase 07; Compare PDFs became a two-file tool in 06).
const singleFilePdfTool = getTool("ocr-to-word")!;

const makeFile = (name: string, size = 10, type = "") =>
  new File([new Uint8Array(size)], name, { type });

/** jsdom's file input is read-only, so the FileList is planted directly. */
function pick(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", {
    value: Object.assign(files, {
      item: (i: number) => files[i] ?? null,
    }) as unknown as FileList,
    configurable: true,
  });
  fireEvent.change(input);
}

function setup(tool = mergePdf, files: File[] = []) {
  const onSelect = vi.fn();
  const onReject = vi.fn();
  const view = render(
    <UploadZone tool={tool} files={files} onSelect={onSelect} onReject={onReject} />,
  );
  const input = view.container.querySelector("input[type=file]") as HTMLInputElement;
  return { onSelect, onReject, input, ...view };
}

describe("checkFiles", () => {
  it("accepts what the tool accepts", () => {
    expect(checkFiles(mergePdf, [{ name: "a.pdf", size: 10 }])).toBeNull();
  });

  it("uses the master-plan §22 wording", () => {
    expect(checkFiles(mergePdf, [{ name: "song.mp3", size: 10 }])).toBe(
      "This file type is not supported.",
    );
    expect(checkFiles(mergePdf, [{ name: "a.pdf", size: 11 }], 10)).toBe(
      "The file is too large for local processing. Try a smaller file.",
    );
  });

  it("catches empty, missing and too many files", () => {
    expect(checkFiles(mergePdf, [])).toMatch(/choose a file/i);
    expect(checkFiles(mergePdf, [{ name: "a.pdf", size: 0 }])).toMatch(/empty/i);
    expect(
      checkFiles(singleFilePdfTool, [
        { name: "a.pdf", size: 1 },
        { name: "b.pdf", size: 1 },
      ]),
    ).toMatch(/one file at a time/i);
  });
});

describe("UploadZone", () => {
  it("shows what the tool takes and how big a file may be", () => {
    setup();
    expect(screen.getByTestId("upload-zone").textContent).toMatch(/accepted: pdf/i);
    expect(screen.getByTestId("upload-zone").textContent).toMatch(/up to 100\.0 mb/i);
  });

  it("passes on accepted files", () => {
    const { input, onSelect, onReject } = setup();
    pick(input, [makeFile("a.pdf")]);
    expect(onReject).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith([expect.objectContaining({ name: "a.pdf" })]);
  });

  it("rejects an unsupported type without calling onSelect", () => {
    const { input, onSelect, onReject } = setup();
    pick(input, [makeFile("song.mp3", 10, "audio/mpeg")]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledWith("This file type is not supported.");
  });

  it("refuses a second file for a single-file tool by replacing it, and rejects a dropped pair", () => {
    const { input, onSelect } = setup(singleFilePdfTool);
    pick(input, [makeFile("a.pdf"), makeFile("b.pdf")]);
    expect(onSelect).toHaveBeenCalledWith([expect.objectContaining({ name: "a.pdf" })]);
  });

  it("appends for a batch tool and can remove one again", () => {
    const existing = makeFile("a.pdf");
    const { input, onSelect } = setup(mergePdf, [existing]);
    pick(input, [makeFile("b.pdf")]);
    expect(onSelect).toHaveBeenCalledWith([
      expect.objectContaining({ name: "a.pdf" }),
      expect.objectContaining({ name: "b.pdf" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /remove a\.pdf/i }));
    expect(onSelect).toHaveBeenLastCalledWith([]);
  });

  it("highlights while dragging and accepts a drop", () => {
    const { onSelect } = setup();
    const zone = screen.getByTestId("upload-zone");
    fireEvent.dragOver(zone);
    expect(zone.getAttribute("data-dragging")).toBe("true");
    fireEvent.drop(zone, { dataTransfer: { files: [makeFile("a.pdf")] } });
    expect(zone.getAttribute("data-dragging")).toBe("false");
    expect(onSelect).toHaveBeenCalled();
  });

  it("ignores input while disabled", () => {
    const onSelect = vi.fn();
    render(
      <UploadZone tool={mergePdf} files={[]} disabled onSelect={onSelect} onReject={vi.fn()} />,
    );
    fireEvent.drop(screen.getByTestId("upload-zone"), {
      dataTransfer: { files: [makeFile("a.pdf")] },
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("formats sizes for humans", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
