"use client";

import { Button } from "@onestop/ui";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  validateLogin,
  validateNewPassword,
  validateResetRequest,
  validateSignup,
  type FieldErrors,
} from "@/lib/validation";
import { AuthForm, type AuthSubmitResult } from "./AuthForm";

/** One place that knows how this app's JSON error envelope maps onto form state. */
async function postJson<K extends string>(
  url: string,
  body: Record<string, unknown>,
): Promise<
  { ok: true; data: Record<string, unknown> } | { ok: false; result: AuthSubmitResult<K> }
> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: { message?: string; field?: string };
  } & Record<string, unknown>;
  if (response.ok && payload.ok) return { ok: true, data: payload };
  const message = payload.error?.message ?? "Something went wrong. Please try again.";
  const field = payload.error?.field as K | undefined;
  return {
    ok: false,
    result: field ? { errors: { [field]: message } as FieldErrors<K> } : { formError: message },
  };
}

function GoogleButton({ enabled, callbackUrl }: { enabled: boolean; callbackUrl: string }) {
  if (!enabled) return null;
  return (
    <Button
      variant="secondary"
      className="w-full"
      type="button"
      onClick={() => void signIn("google", { redirectTo: callbackUrl })}
    >
      Continue with Google
    </Button>
  );
}

export interface AuthFormOptions {
  /** Set by the page from the server, so no dead Google button is ever shown. */
  googleEnabled?: boolean;
  /** False when there is no database: sign-in is impossible and the form says why. */
  available?: boolean;
}

const UNAVAILABLE =
  "Accounts are unavailable on this instance. Every tool still works without signing in.";

export function LoginForm({ googleEnabled = false, available = true }: AuthFormOptions) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params?.get("next");
  const callbackUrl = next && next.startsWith("/") ? next : "/account";

  return (
    <AuthForm
      title="Sign in"
      description="Your history, favourites and workflows follow you once you are signed in."
      submitLabel="Sign in"
      pendingLabel="Signing in…"
      fields={[
        { name: "email", label: "Email", type: "email", autoComplete: "email" },
        { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
      ]}
      validate={validateLogin}
      onSubmit={async ({ email, password }) => {
        if (!available) return { formError: UNAVAILABLE };
        const result = await signIn("credentials", { email, password, redirect: false });
        if (!result || result.error) {
          return { formError: "That email or password is incorrect." };
        }
        router.push(callbackUrl);
        router.refresh();
        return { message: "Signed in. Taking you back…" };
      }}
      extra={<GoogleButton enabled={googleEnabled && available} callbackUrl={callbackUrl} />}
      footer={[
        { text: "Forgot your password?", linkLabel: "Reset it", href: "/auth/reset-password" },
        { text: "New to OneStop?", linkLabel: "Create an account", href: "/auth/signup" },
      ]}
    />
  );
}

export function SignupForm({ googleEnabled = false, available = true }: AuthFormOptions) {
  const router = useRouter();

  return (
    <AuthForm
      title="Create an account"
      description="An account is optional - it only adds saved history, favourites and workflows."
      submitLabel="Create account"
      pendingLabel="Creating your account…"
      fields={[
        { name: "name", label: "Name", type: "text", autoComplete: "name" },
        { name: "email", label: "Email", type: "email", autoComplete: "email" },
        {
          name: "password",
          label: "Password",
          type: "password",
          autoComplete: "new-password",
          hint: "At least 8 characters.",
        },
        {
          name: "confirm",
          label: "Confirm password",
          type: "password",
          autoComplete: "new-password",
        },
      ]}
      validate={validateSignup}
      onSubmit={async ({ name, email, password }) => {
        if (!available) return { formError: UNAVAILABLE };
        const created = await postJson<"name" | "email" | "password" | "confirm">(
          "/api/auth/signup",
          { name, email, password },
        );
        if (!created.ok) return created.result;
        const signedIn = await signIn("credentials", { email, password, redirect: false });
        if (!signedIn || signedIn.error) {
          return { message: "Account created. Sign in to continue." };
        }
        router.push("/account");
        router.refresh();
        return { message: "Account created. Taking you to your account…" };
      }}
      extra={<GoogleButton enabled={googleEnabled && available} callbackUrl="/account" />}
      footer={[{ text: "Already have an account?", linkLabel: "Sign in", href: "/auth/login" }]}
    />
  );
}

/** Step one: ask for a link. The answer never says whether the address has an account. */
function RequestResetForm({ available }: { available: boolean }) {
  return (
    <AuthForm
      title="Reset your password"
      description="We'll email a link that lets you choose a new password."
      submitLabel="Send reset link"
      pendingLabel="Sending…"
      fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email" }]}
      validate={validateResetRequest}
      onSubmit={async ({ email }) => {
        if (!available) return { formError: UNAVAILABLE };
        const requested = await postJson<"email">("/api/auth/reset", { email });
        if (!requested.ok) return requested.result;
        const transport = requested.data.transport;
        const message = String(requested.data.message ?? "Check your email for the link.");
        return {
          message:
            transport === "console"
              ? `${message} This instance has no email provider configured, so the link was written to the server console.`
              : message,
        };
      }}
      footer={[{ text: "Remembered it?", linkLabel: "Back to sign in", href: "/auth/login" }]}
    />
  );
}

/** Step two: the visitor arrived from the emailed link and chooses a new password. */
function SetNewPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ checked: boolean; valid: boolean; reason?: string }>({
    checked: false,
    valid: false,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/auth/reset/confirm?token=${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          valid?: boolean;
          reason?: string;
          error?: { message?: string };
        };
        if (cancelled) return;
        setState({
          checked: true,
          valid: Boolean(payload.valid),
          reason: payload.reason ?? payload.error?.message,
        });
      } catch {
        if (!cancelled) {
          setState({ checked: true, valid: false, reason: "That link could not be checked." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!state.checked) {
    return (
      <p role="status" className="mx-auto w-full max-w-md text-sm text-fg-muted">
        Checking your reset link…
      </p>
    );
  }

  if (!state.valid) {
    return (
      <div className="mx-auto w-full max-w-md">
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm">
          {state.reason ?? "That reset link is not valid. Request a new one."}
        </p>
        <div className="mt-4">
          <RequestResetForm available />
        </div>
      </div>
    );
  }

  return (
    <AuthForm
      title="Choose a new password"
      submitLabel="Save new password"
      pendingLabel="Saving…"
      fields={[
        {
          name: "password",
          label: "New password",
          type: "password",
          autoComplete: "new-password",
          hint: "At least 8 characters.",
        },
        {
          name: "confirm",
          label: "Confirm new password",
          type: "password",
          autoComplete: "new-password",
        },
      ]}
      validate={validateNewPassword}
      onSubmit={async ({ password }) => {
        const saved = await postJson<"password" | "confirm">("/api/auth/reset/confirm", {
          token,
          password,
        });
        if (!saved.ok) return saved.result;
        setTimeout(() => router.push("/auth/login"), 1200);
        return { message: "Your password has been changed. Taking you to sign in…" };
      }}
      footer={[{ text: "Changed your mind?", linkLabel: "Back to sign in", href: "/auth/login" }]}
    />
  );
}

export function ResetPasswordForm({ available = true }: AuthFormOptions) {
  const params = useSearchParams();
  const token = params?.get("token") ?? "";
  if (token && available) return <SetNewPasswordForm token={token} />;
  return <RequestResetForm available={available} />;
}
