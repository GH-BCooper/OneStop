"use client";

// "View" for a selected file (item 5 of the redesign): shows exactly what was picked, before it is
// ever uploaded. Object URLs are created only while the modal is open and revoked on close, so a
// batch of large files never leaks memory.
import { Modal } from "@onestop/ui";
import { useEffect, useState } from "react";
import { formatBytes } from "./UploadZone";

export interface FilePreviewModalProps {
  file: File | null;
  onClose: () => void;
}

function kindOf(file: File): "image" | "video" | "audio" | "pdf" | "text" | "other" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("text/") || /\.(txt|md|csv|json|xml|yaml|yml|log)$/i.test(file.name)) {
    return "text";
  }
  return "other";
}

const MAX_TEXT_PREVIEW_BYTES = 200_000;

export function FilePreviewModal({ file, onClose }: FilePreviewModalProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      setText(null);
      return;
    }
    const kind = kindOf(file);
    if (kind === "text" && file.size <= MAX_TEXT_PREVIEW_BYTES) {
      let cancelled = false;
      void file.text().then((value) => {
        if (!cancelled) setText(value);
      });
      return () => {
        cancelled = true;
      };
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!file) return null;
  const kind = kindOf(file);

  return (
    <Modal open={Boolean(file)} onClose={onClose} title={file.name} className="max-w-2xl">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg-muted">
          {formatBytes(file.size)} · {file.type || "unknown type"}
        </p>
        <div className="flex max-h-[70vh] items-center justify-center overflow-auto rounded-md border border-border bg-surface-muted">
          {kind === "image" && url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={file.name} className="max-h-[65vh] w-auto object-contain" />
          )}
          {kind === "video" && url && (
            <video src={url} controls className="max-h-[65vh] w-full">
              <track kind="captions" />
            </video>
          )}
          {kind === "audio" && url && <audio src={url} controls className="w-full p-6" />}
          {kind === "pdf" && url && (
            <iframe src={url} title={file.name} className="h-[65vh] w-full" />
          )}
          {kind === "text" && text !== null && (
            <pre className="max-h-[65vh] w-full overflow-auto whitespace-pre-wrap p-4 text-left text-xs">
              {text}
            </pre>
          )}
          {kind === "text" && text === null && (
            <p className="p-6 text-sm text-fg-muted">This file is too large to preview here.</p>
          )}
          {kind === "other" && (
            <p className="p-6 text-sm text-fg-muted">
              There is no preview for this file type — the file itself is unaffected.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
