"use client";

// Fills a registry `client` option from the browser (12-dev-utility-tools.md).
//
// Some questions can only be answered on this side of the wire: "what am I browsing with?" and
// "what is my time zone?". The registry declares which browser value a tool wants; this component
// reads it once on mount and hands it to the form like any other option value, then shows it
// read-only so nothing is taken silently.
import { useEffect, useRef } from "react";
import type { ClientOption } from "@onestop/tool-registry";
import { readAiKey, readPreferredAI } from "@/lib/preferences";

export function readClientValue(source: ClientOption["source"]): string {
  if (typeof window === "undefined") return "";
  try {
    if (source === "userAgent") return navigator.userAgent ?? "";
    if (source === "timeZone") return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    // The AI runtime and its key are Settings values the server cannot know (16-ai-assistant.md).
    // They are always `visible: false`, so nothing is shown on the page: the key in particular is
    // never rendered, and `redactOptionValues` strips it before the run is recorded.
    if (source === "aiProvider") return readPreferredAI() ?? "";
    if (source === "aiKey") return readAiKey();
    return navigator.language ?? "";
  } catch {
    return "";
  }
}

export interface ClientValueProps {
  id: string;
  option: ClientOption;
  value: string;
  onChange(value: string): void;
}

export function ClientValue({ id, option, value, onChange }: ClientValueProps) {
  // Refs, so the effect depends only on which browser value is wanted: it fills the value once,
  // when the control appears, and never fights the form afterwards.
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  useEffect(() => {
    const detected = readClientValue(option.source);
    if (detected !== "" && detected !== latest.current.value) latest.current.onChange(detected);
  }, [option.source]);

  if (option.visible === false) return null;

  const hintId = option.help ? `${id}-hint` : undefined;
  return (
    <div className="flex w-full min-w-0 flex-col gap-1 sm:col-span-2">
      <label htmlFor={id} className="text-sm font-medium">
        {option.label}
      </label>
      <output
        id={id}
        data-testid={`client-option-${option.id}`}
        aria-describedby={hintId}
        className="block w-full min-w-0 overflow-x-auto rounded-md border border-border bg-surface-muted px-3 py-2 font-mono text-sm break-all text-fg-muted"
      >
        {value === "" ? "Reading from your browser…" : value}
      </output>
      {option.help && (
        <p id={hintId} className="text-sm text-fg-muted">
          {option.help}
        </p>
      )}
    </div>
  );
}
