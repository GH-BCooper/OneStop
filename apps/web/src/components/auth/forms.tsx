"use client";

import { validateLogin, validateResetRequest, validateSignup } from "@/lib/validation";
import { AuthForm } from "./AuthForm";

const pending = "Looks good. Sign-in isn't switched on yet, so nothing was sent.";

export function LoginForm() {
  return (
    <AuthForm
      title="Sign in"
      submitLabel="Sign in"
      fields={[
        { name: "email", label: "Email", type: "email", autoComplete: "email" },
        { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
      ]}
      validate={validateLogin}
      successMessage={pending}
      showGoogle
      footer={[
        { text: "Forgot your password?", linkLabel: "Reset it", href: "/auth/reset-password" },
        { text: "New to OneStop?", linkLabel: "Create an account", href: "/auth/signup" },
      ]}
    />
  );
}

export function SignupForm() {
  return (
    <AuthForm
      title="Create an account"
      submitLabel="Create account"
      fields={[
        { name: "name", label: "Name", type: "text", autoComplete: "name" },
        { name: "email", label: "Email", type: "email", autoComplete: "email" },
        { name: "password", label: "Password", type: "password", autoComplete: "new-password" },
        {
          name: "confirm",
          label: "Confirm password",
          type: "password",
          autoComplete: "new-password",
        },
      ]}
      validate={validateSignup}
      successMessage={pending}
      showGoogle
      footer={[{ text: "Already have an account?", linkLabel: "Sign in", href: "/auth/login" }]}
    />
  );
}

export function ResetPasswordForm() {
  return (
    <AuthForm
      title="Reset your password"
      submitLabel="Send reset link"
      fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email" }]}
      validate={validateResetRequest}
      successMessage="Looks good. Password reset emails aren't switched on yet, so nothing was sent."
      footer={[{ text: "Remembered it?", linkLabel: "Back to sign in", href: "/auth/login" }]}
    />
  );
}
