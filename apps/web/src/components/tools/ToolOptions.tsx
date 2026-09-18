"use client";

// Renders a tool's options from the registry (05-pdf-tools-core.md).
//
// The generic tool page has no per-tool code: it asks the registry what a tool can be asked to
// do and draws the controls. Every later tool phase adds entries to `TOOL_OPTIONS`, not to this
// file — so options stay part of the one contract the AI Assistant and Workflows also read.
import { isOptionVisible, type ToolOption } from "@onestop/tool-registry";
import { Input } from "@onestop/ui";
import { useId } from "react";
import { SignaturePad } from "./SignaturePad";

export type OptionValues = Record<string, string | number | boolean>;

export interface ToolOptionsProps {
  options: ToolOption[];
  values: OptionValues;
  disabled?: boolean;
  onChange(id: string, value: string | number | boolean): void;
}

const selectClasses =
  "h-10 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-fg " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

export function ToolOptions({ options, values, disabled, onChange }: ToolOptionsProps) {
  const groupId = useId();
  const visible = options.filter((option) => isOptionVisible(option, values));

  if (visible.length === 0) {
    return <p className="text-sm text-fg-muted">No options for this tool yet.</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid="tool-options">
      {visible.map((option) => {
        const fieldId = `${groupId}-${option.id}`;
        const hintId = option.help ? `${fieldId}-hint` : undefined;

        if (option.type === "select") {
          return (
            <div key={option.id} className="flex w-full min-w-0 flex-col gap-1">
              <label htmlFor={fieldId} className="text-sm font-medium">
                {option.label}
              </label>
              <select
                id={fieldId}
                className={selectClasses}
                disabled={disabled}
                aria-describedby={hintId}
                value={String(values[option.id] ?? option.default)}
                onChange={(e) => onChange(option.id, e.target.value)}
              >
                {option.choices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
              {option.help && (
                <p id={hintId} className="text-sm text-fg-muted">
                  {option.help}
                </p>
              )}
            </div>
          );
        }

        if (option.type === "boolean") {
          return (
            <div key={option.id} className="flex w-full min-w-0 flex-col gap-1">
              <label htmlFor={fieldId} className="flex items-center gap-2 text-sm font-medium">
                <input
                  id={fieldId}
                  type="checkbox"
                  className="size-4 accent-[var(--os-color-accent)]"
                  disabled={disabled}
                  aria-describedby={hintId}
                  checked={values[option.id] === true}
                  onChange={(e) => onChange(option.id, e.target.checked)}
                />
                {option.label}
              </label>
              {option.help && (
                <p id={hintId} className="text-sm text-fg-muted">
                  {option.help}
                </p>
              )}
            </div>
          );
        }

        if (option.type === "number") {
          return (
            <Input
              key={option.id}
              id={fieldId}
              type="number"
              label={option.unit ? `${option.label} (${option.unit})` : option.label}
              min={option.min}
              max={option.max}
              step={option.step ?? 1}
              disabled={disabled}
              {...(option.help ? { hint: option.help } : {})}
              value={String(values[option.id] ?? option.default)}
              onChange={(e) =>
                onChange(option.id, e.target.value === "" ? "" : Number(e.target.value))
              }
            />
          );
        }

        if (option.type === "signature") {
          return (
            <SignaturePad
              key={option.id}
              id={fieldId}
              label={option.label}
              value={String(values[option.id] ?? "")}
              {...(disabled !== undefined ? { disabled } : {})}
              onChange={(value) => onChange(option.id, value)}
            />
          );
        }

        if (option.multiline) {
          return (
            <div key={option.id} className="flex w-full min-w-0 flex-col gap-1 sm:col-span-2">
              <label htmlFor={fieldId} className="text-sm font-medium">
                {option.label}
              </label>
              <textarea
                id={fieldId}
                rows={6}
                className={
                  "w-full min-w-0 rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-fg " +
                  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                }
                disabled={disabled}
                aria-describedby={hintId}
                spellCheck={false}
                {...(option.placeholder ? { placeholder: option.placeholder } : {})}
                value={String(values[option.id] ?? option.default)}
                onChange={(e) => onChange(option.id, e.target.value)}
              />
              {option.help && (
                <p id={hintId} className="text-sm text-fg-muted">
                  {option.help}
                </p>
              )}
            </div>
          );
        }

        return (
          <Input
            key={option.id}
            id={fieldId}
            type={option.secret ? "password" : "text"}
            {...(option.secret ? { autoComplete: "new-password" } : {})}
            label={option.label}
            disabled={disabled}
            {...(option.placeholder ? { placeholder: option.placeholder } : {})}
            {...(option.help ? { hint: option.help } : {})}
            value={String(values[option.id] ?? option.default)}
            onChange={(e) => onChange(option.id, e.target.value)}
          />
        );
      })}
    </div>
  );
}
