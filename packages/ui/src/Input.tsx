import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visible label. Required for accessibility unless `aria-label` is given. */
  label?: string;
  hideLabel?: boolean;
  error?: string;
  hint?: string;
  /** Rendered inside the field, right-aligned — e.g. the show/hide button on a password field. */
  endAdornment?: ReactNode;
}

export function Input({
  label,
  hideLabel,
  error,
  hint,
  id,
  className,
  endAdornment,
  ...props
}: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className={cn("text-sm font-medium", hideLabel && "sr-only")}>
          {label}
        </label>
      )}
      <div className="relative flex w-full min-w-0 items-center">
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "h-10 w-full min-w-0 rounded-md border bg-surface px-3 text-fg placeholder:text-fg-muted",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
            error ? "border-danger" : "border-border",
            endAdornment ? "pr-10" : undefined,
            className,
          )}
          {...props}
        />
        {endAdornment && (
          <div className="absolute right-1 flex items-center">{endAdornment}</div>
        )}
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${inputId}-hint`} className="text-sm text-fg-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
