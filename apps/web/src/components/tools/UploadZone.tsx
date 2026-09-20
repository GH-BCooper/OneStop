"use client";

// The drop zone used by every file tool (04-file-core.md).
//
// It does a friendly pre-check (type, size, count) so obvious mistakes are caught before anything
// is uploaded. It is *not* the security boundary: the server revalidates every file in
// `apps/api/src/file-processing/validate.ts`, and that check is the one that counts.
import {
  acceptAttribute,
  acceptsFileName,
  fileInputTypes,
  typeLabel,
  type ToolMeta,
} from "@onestop/tool-registry";
import { DEFAULT_MAX_UPLOAD_BYTES, ERROR_MESSAGES } from "@onestop/types";
import { Button } from "@onestop/ui";
import { useId, useRef, useState, type DragEvent } from "react";
import { FilePreviewModal } from "./FilePreviewModal";

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

export interface UploadZoneProps {
  tool: Pick<ToolMeta, "name" | "inputTypes" | "supportsBatch">;
  files: File[];
  disabled?: boolean;
  maxBytes?: number;
  inputId?: string;
  onSelect: (files: File[]) => void;
  /** Called with a ready-to-show message when the picked files can't be used. */
  onReject: (message: string) => void;
}

/** Returns the message for the first unusable file, or null when the whole set is fine. */
export function checkFiles(
  tool: Pick<UploadZoneProps["tool"], "inputTypes" | "supportsBatch">,
  files: readonly { name: string; size: number }[],
  maxBytes = DEFAULT_MAX_UPLOAD_BYTES,
): string | null {
  if (files.length === 0) return "Choose a file first.";
  if (!tool.supportsBatch && files.length > 1) return "This tool takes one file at a time.";
  for (const file of files) {
    if (!acceptsFileName(tool, file.name)) return ERROR_MESSAGES.unsupportedType;
    if (file.size === 0) return "This file is empty. Choose a file with content.";
    if (file.size > maxBytes) return ERROR_MESSAGES.tooLarge;
  }
  return null;
}

export function UploadZone({
  tool,
  files,
  disabled = false,
  maxBytes = DEFAULT_MAX_UPLOAD_BYTES,
  inputId,
  onSelect,
  onReject,
}: UploadZoneProps) {
  const generatedId = useId();
  const id = inputId ?? generatedId;
  const [dragging, setDragging] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const accepted = typeLabel(fileInputTypes(tool));

  const take = (list: FileList | File[] | null) => {
    const picked = list ? Array.from(list) : [];
    if (picked.length === 0) return;
    const next = tool.supportsBatch ? [...files, ...picked] : picked.slice(0, 1);
    const problem = checkFiles(tool, next, maxBytes);
    if (problem) {
      onReject(problem);
      return;
    }
    onSelect(next);
  };

  const removeAt = (index: number) => {
    onSelect(files.filter((_, i) => i !== index));
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={id}
        data-testid="upload-zone"
        data-dragging={dragging ? "true" : "false"}
        onDragOver={(e: DragEvent<HTMLLabelElement>) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e: DragEvent<HTMLLabelElement>) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) take(e.dataTransfer.files);
        }}
        className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-6 text-center ${
          dragging ? "border-primary bg-surface-muted" : "border-border bg-surface"
        } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <span className="font-medium">
          Drop {tool.supportsBatch ? "files" : "a file"} here or click to browse
        </span>
        <span className="text-sm text-fg-muted">Accepted: {accepted}</span>
        <span className="text-sm text-fg-muted">Up to {formatBytes(maxBytes)} per file</span>
      </label>
      <input
        id={id}
        ref={inputRef}
        type="file"
        className="sr-only"
        multiple={tool.supportsBatch}
        accept={acceptAttribute(tool)}
        disabled={disabled}
        onChange={(e) => take(e.target.files)}
      />
      {files.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm" aria-label="Selected files">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${file.size}-${i}`}
              className="flex items-center justify-between gap-2 rounded-md bg-surface-muted px-3 py-2"
            >
              <span className="truncate">{file.name}</span>
              <span className="flex shrink-0 items-center gap-2 text-fg-muted">
                {formatBytes(file.size)}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`View ${file.name}`}
                  onClick={() => setPreviewIndex(i)}
                >
                  View
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  aria-label={`Remove ${file.name}`}
                  onClick={() => removeAt(i)}
                >
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <FilePreviewModal
        file={previewIndex !== null ? (files[previewIndex] ?? null) : null}
        onClose={() => setPreviewIndex(null)}
      />
    </div>
  );
}
