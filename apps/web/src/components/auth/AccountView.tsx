"use client";

import type { PublicUser, UserSettings } from "@onestop/types";
import { Button, Card, Input, PasswordInput, Tabs } from "@onestop/ui";
import { signOut } from "next-auth/react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { SettingsView } from "@/components/settings/SettingsView";
import { validatePasswordChange, type FieldErrors } from "@/lib/validation";

export interface AccountViewProps {
  user: PublicUser;
  settings: UserSettings;
  jobCount: number;
}

async function send(url: string, method: string, body?: BodyInit, json = true) {
  const response = await fetch(url, {
    method,
    ...(body
      ? {
          headers: json ? { "content-type": "application/json" } : undefined,
          body,
        }
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

function AvatarEditor({
  avatar,
  name,
  onChanged,
}: {
  avatar: string | null;
  name: string;
  onChanged: (avatar: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const initial = (name.trim().charAt(0) || "?").toUpperCase();

  const upload = async (file: File) => {
    setPending(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    const result = await send("/api/account/avatar", "POST", form, false);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onChanged((result.data.user as PublicUser).avatar);
  };

  const remove = async () => {
    setPending(true);
    setError(null);
    const result = await send("/api/account/avatar", "DELETE");
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onChanged(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <div
          data-testid="avatar-dropzone"
          data-dragging={dragging ? "true" : "false"}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          role="button"
          tabIndex={0}
          aria-label="Change profile picture"
          onDragOver={(e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) void upload(file);
          }}
          className={`flex h-20 w-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed text-2xl font-semibold ${
            dragging ? "border-primary bg-surface-muted" : "border-border bg-surface-muted"
          }`}
        >
          {avatar ? (
            <Image
              src={avatar}
              alt=""
              width={80}
              height={80}
              unoptimized
              className="h-full w-full object-cover"
            />
          ) : (
            <span aria-hidden="true" className="text-fg-muted">
              {initial}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-fg-muted">Drag an image here, or click it to browse.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => inputRef.current?.click()}
            >
              {pending ? "Working…" : avatar ? "Update" : "Add a picture"}
            </Button>
            {avatar && (
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void remove()}>
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="sr-only"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function PersonalSettings({ user, settings, jobCount }: AccountViewProps) {
  const router = useRouter();
  const [name, setName] = useState(user.name ?? "");
  const [avatar, setAvatar] = useState(user.avatar);
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

  const mismatch =
    passwords.confirm !== "" && passwords.confirm !== passwords.newPassword
      ? "Passwords don't match."
      : undefined;

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfile(null);
    setProfilePending(true);
    const result = await send("/api/account", "PATCH", JSON.stringify({ name }));
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
    const result = await send(
      "/api/account/password",
      "POST",
      JSON.stringify({
        currentPassword: passwords.currentPassword,
        newPassword: passwords.newPassword,
      }),
    );
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
      <Section title="Profile" description="Your email address is the key to the account.">
        <AvatarEditor avatar={avatar} name={user.name ?? user.email} onChanged={setAvatar} />
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
            <PasswordInput
              label="Current password"
              name="currentPassword"
              autoComplete="current-password"
              value={passwords.currentPassword}
              error={passwordErrors.currentPassword}
              disabled={passwordPending}
              onChange={(e) => setPasswords((p) => ({ ...p, currentPassword: e.target.value }))}
            />
            <PasswordInput
              label="New password"
              name="newPassword"
              autoComplete="new-password"
              hint="At least 8 characters."
              value={passwords.newPassword}
              error={passwordErrors.newPassword}
              disabled={passwordPending}
              onChange={(e) => setPasswords((p) => ({ ...p, newPassword: e.target.value }))}
            />
            <PasswordInput
              label="Confirm new password"
              name="confirm"
              autoComplete="new-password"
              value={passwords.confirm}
              error={passwordErrors.confirm ?? mismatch}
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

export function AccountView(props: AccountViewProps) {
  const { user } = props;
  const params = useSearchParams();
  const defaultTab = params?.get("tab") === "app" ? "app" : "personal";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Account</h1>
          <p className="text-sm text-fg-muted">
            {/* A fixed locale, not the browser's: the server renders this same text first, and an
                unpinned toLocaleDateString() can disagree with the client's OS locale (seen live
                as "9/20/2026" vs "20/9/2026"), which is a real hydration-mismatch bug, not a
                cosmetic one. */}
            {user.email} · joined {new Date(user.createdAt).toLocaleDateString("en-US")}
          </p>
        </div>
        <Button variant="secondary" onClick={() => void signOut({ redirectTo: "/" })}>
          Sign out
        </Button>
      </div>

      <Tabs
        label="Account sections"
        defaultTabId={defaultTab}
        items={[
          { id: "personal", label: "Personal", content: <PersonalSettings {...props} /> },
          { id: "app", label: "App", content: <SettingsView accountsEnabled /> },
        ]}
      />
    </div>
  );
}
