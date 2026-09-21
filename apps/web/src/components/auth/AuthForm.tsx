"use client";

import { Button, Card, Input, PasswordInput } from "@onestop/ui";
import Link from "next/link";
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import type { FieldErrors } from "@/lib/validation";

export interface AuthField<K extends string> {
  name: K;
  label: string;
  type: "text" | "email" | "password";
  autoComplete: string;
  hint?: string;
  /** A one-time code: numeric keypad, digits only, capped length. */
  digitsOnly?: boolean;
  maxLength?: number;
}

/** What a submit handler reports back to the form. */
export interface AuthSubmitResult<K extends string> {
  /** A short confirmation to show in place of the form's status line. */
  message?: string;
  /** Field-level problems the server found, keyed the same way as the client's validation. */
  errors?: FieldErrors<K>;
  /** A problem that belongs to the whole form (wrong credentials, database down). */
  formError?: string;
}

export interface AuthFormProps<K extends string> {
  title: string;
  description?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  fields: AuthField<K>[];
  validate: (values: Record<K, string>) => FieldErrors<K>;
  onSubmit: (values: Record<K, string>) => Promise<AuthSubmitResult<K> | void>;
  footer?: { text: string; linkLabel: string; href: string }[];
  /** Rendered under the submit button - the Google button lives here. */
  extra?: ReactNode;
}

export function AuthForm<K extends string>({
  title,
  description,
  submitLabel,
  pendingLabel = "Working…",
  fields,
  validate,
  onSubmit,
  footer = [],
  extra,
}: AuthFormProps<K>) {
  const empty = Object.fromEntries(fields.map((f) => [f.name, ""])) as Record<K, string>;
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState<FieldErrors<K>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const next = validate(values);
    setErrors(next);
    setFormError(null);
    setMessage(null);
    if (Object.keys(next).length > 0) return;

    setPending(true);
    try {
      const result = (await onSubmit(values)) ?? {};
      if (result.errors && Object.keys(result.errors).length > 0) setErrors(result.errors);
      if (result.formError) setFormError(result.formError);
      if (result.message) setMessage(result.message);
    } catch (err) {
      // Anything unexpected (a dropped connection) gets the same short, actionable line.
      console.error("[auth] submit failed", err);
      setFormError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md">
      <Card className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">{title}</h1>
          {description && <p className="text-sm text-fg-muted">{description}</p>}
        </div>
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          {fields.map((f) => {
            // "Confirm password" fields pair with the field literally named "password" - true of
            // every AuthForm call site - and get a live mismatch warning as the visitor types,
            // rather than waiting for a submit attempt to point out something they can see for
            // themselves right now.
            const isConfirm = f.name === "confirm";
            const liveMismatch =
              isConfirm &&
              values[f.name] !== "" &&
              values[f.name] !== (values as Record<string, string>)["password"]
                ? "Passwords don't match."
                : undefined;
            const shared = {
              name: f.name,
              label: f.label,
              autoComplete: f.autoComplete,
              hint: f.hint,
              value: values[f.name],
              error: errors[f.name] ?? liveMismatch,
              disabled: pending,
              onChange: (e: ChangeEvent<HTMLInputElement>) => {
                const next = f.digitsOnly ? e.target.value.replace(/\D/g, "") : e.target.value;
                setValues((v) => ({ ...v, [f.name]: next }));
                setMessage(null);
                setFormError(null);
              },
            };
            return f.type === "password" ? (
              <PasswordInput key={f.name} {...shared} />
            ) : (
              <Input
                key={f.name}
                {...shared}
                type={f.type}
                {...(f.digitsOnly ? { inputMode: "numeric" as const } : {})}
                {...(f.maxLength ? { maxLength: f.maxLength } : {})}
              />
            );
          })}
          {formError && (
            <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm">
              {formError}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? pendingLabel : submitLabel}
          </Button>
        </form>
        {message && (
          <p role="status" className="rounded-md border border-border bg-surface-muted p-3 text-sm">
            {message}
          </p>
        )}
        {extra}
        {footer.map((f) => (
          <p key={f.href} className="text-center text-sm text-fg-muted">
            {f.text}{" "}
            <Link href={f.href} className="text-primary hover:underline">
              {f.linkLabel}
            </Link>
          </p>
        ))}
      </Card>
    </div>
  );
}
