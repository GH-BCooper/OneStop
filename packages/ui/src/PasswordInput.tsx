"use client";

import { useState } from "react";
import { Input, type InputProps } from "./Input";

export type PasswordInputProps = Omit<InputProps, "type" | "endAdornment">;

/** A password field with a show/hide toggle. Every password field in the app uses this one. */
export function PasswordInput(props: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <Input
      {...props}
      type={visible ? "text" : "password"}
      endAdornment={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          tabIndex={-1}
          className="inline-flex h-8 w-8 items-center justify-center rounded text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span aria-hidden="true">{visible ? "🙈" : "👁️"}</span>
        </button>
      }
    />
  );
}
