"use client";

// The `image` option control (11-qr-tools.md, QR Code Customization's logo).
//
// The picked file is read in the browser and handed to the tool as a data URL, exactly like the
// signature pad, so an option never has to become a second upload field in the pipeline.
import { Button } from "@onestop/ui";
import { useRef, useState } from "react";

/** Options are JSON in one form field, so a logo has to stay small. */
export const MAX_OPTION_IMAGE_BYTES = 1_000_000;

const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export interface ImagePickerProps {
  id: string;
  label: string;
  value: string;
  help?: string;
  disabled?: boolean;
  onChange(value: string): void;
}

export function ImagePicker({ id, label, value, help, disabled, onChange }: ImagePickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const hintId = help ? `${id}-hint` : undefined;

  const pick = async (file: File | undefined) => {
    setError("");
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      setError("Choose a PNG, JPG, WebP or GIF image.");
      return;
    }
    if (file.size > MAX_OPTION_IMAGE_BYTES) {
      setError("That image is over 1 MB. Choose a smaller one — a logo needs very little detail.");
      return;
    }
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsDataURL(file);
    }).catch(() => "");
    if (dataUrl === "") {
      setError("That image could not be read. Try another file.");
      return;
    }
    setName(file.name);
    onChange(dataUrl);
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={ACCEPTED.join(",")}
        disabled={disabled}
        aria-describedby={hintId}
        className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-fg"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      {value !== "" && (
        <div className="flex items-center gap-2">
          {/* A data URL from the user's own device; next/image would only add a round trip. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Chosen logo"
            className="size-10 rounded border border-border object-contain"
          />
          <span className="truncate text-sm text-fg-muted">{name || "Selected"}</span>
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setName("");
              onChange("");
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            Remove
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      {help && (
        <p id={hintId} className="text-sm text-fg-muted">
          {help}
        </p>
      )}
    </div>
  );
}
