"use client";

import type { PublicUser, UserSettings } from "@onestop/types";
import { Button, Card, Input } from "@onestop/ui";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { validatePasswordChange, type FieldErrors } from "@/lib/validation";

export interface AccountViewProps {
  user: PublicUser;
  settings: UserSettings;
  jobCount: number;
}

async function send(url: string, method: string, body?: Record<string, unknown>) {
  const response = await fetch(url, {
    method,
    ...(body
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: { message?: string; field?: string };
  } & Record<string, unknown>;
  if (response.ok && payload.ok) return { ok: true as const, data: payload };
  return {
    ok: false as const,
    message: payload.error?.message ?? "Something went wrong. Please try again.",
    field: payload.error?.field,
  };
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-fg-muted">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

function Status({ tone, children }: { tone: "ok" | "error"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "rounded-md border border-danger/40 bg-danger/10 p-3 text-sm"
          : "rounded-md border border-border bg-surface-muted p-3 text-sm"
      }
    >
      {children}
    </p>
  );
}

export function AccountView({ user, settings, jobCount }: AccountViewProps) {
  const router = useRouter();
  const [name, setName] = useState(user.name ?? "");
  const [profile, setProfile] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [profilePending, setProfilePending] = useState(false);

  const [passwords, setPasswords] = useState({
    currentPassword: "",
    newPassword: "",
    confirm: "",
  });
  const [passwordErrors, setPasswordErrors] = useState<
    FieldErrors<"currentPassword" | "newPassword" | "confirm">
  >({});
  const [passwordStatus, setPasswordStatus] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [passwordPending, setPasswordPending] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletePending, setDeletePending] = useState(false);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfile(null);
    setProfilePending(true);
    const result = await send("/api/account", "PATCH", { name });
    setProfilePending(false);
    if (!result.ok) {
      setProfile({ tone: "error", text: result.message });
      return;
    }
    setProfile({ tone: "ok", text: "Saved." });
    router.refresh();
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const problems = validatePasswordChange(passwords);
    setPasswordErrors(problems);
    setPasswordStatus(null);
    if (Object.keys(problems).length > 0) return;
    setPasswordPending(true);
    const result = await send("/api/account/password", "POST", {
      currentPassword: passwords.currentPassword,
      newPassword: passwords.newPassword,
    });
    setPasswordPending(false);
    if (!result.ok) {
      if (result.field) {
        setPasswordErrors({ [result.field]: result.message } as FieldErrors<"currentPassword">);
      } else {
        setPasswordStatus({ tone: "error", text: result.message });
      }
      return;
    }
    setPasswords({ currentPassword: "", newPassword: "", confirm: "" });
    setPasswordStatus({ tone: "ok", text: "Your password has been changed." });
  };

  const removeAccount = async () => {
    setDeletePending(true);
    const result = await send("/api/account", "DELETE");
    setDeletePending(false);
    if (!result.ok) {
      setProfile({ tone: "error", text: result.message });
      return;
    }
    await signOut({ redirectTo: "/" });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Account</h1>
          <p className="text-sm text-fg-muted">
            {user.email} · joined {new Date(user.createdAt).toLocaleDateString()}
          </p>
        </div>
        <Button variant="secondary" onClick={() => void signOut({ redirectTo: "/" })}>
          Sign out
        </Button>
      </div>

      <Section title="Profile" description="Your email address is the key to the account.">
        <form className="flex flex-col gap-4" onSubmit={saveProfile} noValidate>
          <Input
            label="Name"
            name="name"
            autoComplete="name"
            value={name}
            disabled={profilePending}
            onChange={(e) => {
              setName(e.target.value);
              setProfile(null);
            }}
          />
          <Input label="Email" name="email" value={user.email} readOnly disabled />
          <div>
            <Button type="submit" disabled={profilePending}>
              {profilePending ? "Saving…" : "Save profile"}
            </Button>
          </div>
          {profile && <Status tone={profile.tone}>{profile.text}</Status>}
        </form>
      </Section>

      <Section
        title="Password"
        description={
          user.hasPassword
            ? "Change the password you sign in with."
            : "This account signs in with Google. Use “Forgot password” on the sign-in page to add a password."
        }
      >
        {user.hasPassword ? (
          <form className="flex flex-col gap-4" onSubmit={savePassword} noValidate>
            <Input
              label="Current password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              value={passwords.currentPassword}
              error={passwordErrors.currentPassword}
              disabled={passwordPending}
              onChange={(e) => setPasswords((p) => ({ ...p, currentPassword: e.target.value }))}
            />
            <Input
              label="New password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              hint="At least 8 characters."
              value={passwords.newPassword}
              error={passwordErrors.newPassword}
              disabled={passwordPending}
              onChange={(e) => setPasswords((p) => ({ ...p, newPassword: e.target.value }))}
            />
            <Input
              label="Confirm new password"
              name="confirm"
              type="password"
              autoComplete="new-password"
              value={passwords.confirm}
              error={passwordErrors.confirm}
              disabled={passwordPending}
              onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))}
            />
            <div>
              <Button type="submit" disabled={passwordPending}>
                {passwordPending ? "Saving…" : "Change password"}
              </Button>
            </div>
            {passwordStatus && <Status tone={passwordStatus.tone}>{passwordStatus.text}</Status>}
          </form>
        ) : null}
      </Section>

      <Section
        title="Your data"
        description="Files are never kept: only the metadata of what you ran, and for how long."
      >
        <p className="text-sm">
          {jobCount === 0
            ? "No tool runs are linked to this account yet."
            : `${jobCount} recent tool ${jobCount === 1 ? "run is" : "runs are"} linked to this account.`}{" "}
          Theme preference: <strong>{settings.theme}</strong>.
        </p>
      </Section>

      <Section title="Delete account" description="This cannot be undone.">
        {confirmDelete ? (
          <div className="flex flex-col gap-3">
            <Status tone="error">
              Deleting removes your profile, settings and saved workflows. Tool runs stay in the
              history table without a name attached.
            </Status>
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={() => void removeAccount()}
                disabled={deletePending}
              >
                {deletePending ? "Deleting…" : "Yes, delete my account"}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
              Delete account
            </Button>
          </div>
        )}
      </Section>
    </div>
  );
}
