"use client";

import { Button, Card, Input } from "@onestop/ui";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { FieldErrors } from "@/lib/validation";

export interface AuthField<K extends string> {
  name: K;
  label: string;
  type: "text" | "email" | "password";
  autoComplete: string;
}

export interface AuthFormProps<K extends string> {
  title: string;
  submitLabel: string;
  fields: AuthField<K>[];
  validate: (values: Record<K, string>) => FieldErrors<K>;
  successMessage: string;
  footer?: { text: string; linkLabel: string; href: string }[];
  showGoogle?: boolean;
}

export function AuthForm<K extends string>({
  title,
  submitLabel,
  fields,
  validate,
  successMessage,
  footer = [],
  showGoogle,
}: AuthFormProps<K>) {
  const empty = Object.fromEntries(fields.map((f) => [f.name, ""])) as Record<K, string>;
  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState<FieldErrors<K>>({});
  const [submitted, setSubmitted] = useState(false);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next = validate(values);
    setErrors(next);
    // TODO(13-auth-database.md): call Auth.js instead of just acknowledging.
    setSubmitted(Object.keys(next).length === 0);
  };

  return (
    <div className="mx-auto w-full max-w-md">
      <Card className="flex flex-col gap-5 p-6">
        <h1 className="text-2xl font-bold">{title}</h1>
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
          {fields.map((f) => (
            <Input
              key={f.name}
              name={f.name}
              label={f.label}
              type={f.type}
              autoComplete={f.autoComplete}
              value={values[f.name]}
              error={errors[f.name]}
              onChange={(e) => {
                setValues((v) => ({ ...v, [f.name]: e.target.value }));
                setSubmitted(false);
              }}
            />
          ))}
          <Button type="submit" className="w-full">
            {submitLabel}
          </Button>
        </form>
        {submitted && (
          <p role="status" className="rounded-md border border-border bg-surface-muted p-3 text-sm">
            {successMessage}
          </p>
        )}
        {showGoogle && (
          <Button
            variant="secondary"
            className="w-full"
            disabled
            title="Available once accounts launch"
          >
            Continue with Google
          </Button>
        )}
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
