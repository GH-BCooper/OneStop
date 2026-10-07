"use client";

// Header entry point for accounts (13-auth-database.md). A guest sees "Sign in"; a signed-in
// visitor sees a dropdown with the two settings tabs and sign out - there is nothing else a click
// on "Account" should do once there is an account to manage.
import { buttonClasses, cn } from "@onestop/ui";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { PROFILE_UPDATED, type ProfilePatch } from "@/lib/profile-events";
import { signOutToLanding } from "@/lib/sign-out";

export interface AccountMenuProps {
  isOpen?: boolean;
  onToggle?: () => void;
  onClose?: () => void;
}

/** Mounted by the header only when accounts are configured, so it can rely on the session. */
export function AccountMenu({ isOpen, onToggle, onClose }: AccountMenuProps = {}) {
  const { data: session, status } = useSession();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = isOpen !== undefined;
  const open = isControlled ? isOpen : internalOpen;

  const handleToggle = () => {
    if (isControlled) {
      onToggle?.();
    } else {
      setInternalOpen((o) => !o);
    }
  };

  const handleClose = () => {
    if (isControlled) {
      onClose?.();
    } else {
      setInternalOpen(false);
    }
  };

  // A name or picture changed on the profile page: shown at once, ahead of the session cookie.
  const [changed, setChanged] = useState<ProfilePatch>({});
  // Track the user ID so we can wipe the patch if the account switches.
  const lastUserIdRef = useRef<string | null | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Reset the local patch whenever a different user's session arrives, so a
  // cached avatar/name from account A never bleeds into account B.
  const userKey = session?.user?.id ?? session?.user?.email ?? null;
  useEffect(() => {
    if (lastUserIdRef.current !== undefined && lastUserIdRef.current !== userKey) {
      setChanged({});
    }
    lastUserIdRef.current = userKey;
  }, [userKey]);

  useEffect(() => {
    const onChange = (e: Event) =>
      setChanged((prev) => ({ ...prev, ...(e as CustomEvent<ProfilePatch>).detail }));
    window.addEventListener(PROFILE_UPDATED, onChange);
    return () => window.removeEventListener(PROFILE_UPDATED, onChange);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) handleClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, isControlled]);

  if (status === "loading") {
    return <span className="hidden h-9 w-20 animate-pulse rounded-md bg-surface-muted sm:block" />;
  }

  if (!session?.user) {
    return (
      <Link href="/auth/login" className={buttonClasses("secondary", "sm")}>
        Sign in
      </Link>
    );
  }

  const label = (changed.name ?? session.user.name)?.trim() || session.user.email || "Account";
  const initial = label.trim().charAt(0).toUpperCase() || "A";
  const rawAvatar = changed.image !== undefined ? changed.image : session.user.image;
  const avatar = rawAvatar
    ? rawAvatar.startsWith("/api/account/avatar") && !rawAvatar.includes("?u=")
      ? `${rawAvatar}?u=${encodeURIComponent(session.user.id ?? session.user.email ?? "user")}`
      : rawAvatar
    : null;

  return (
    <div ref={rootRef} className="relative z-[110]">
      <button
        type="button"
        onClick={handleToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={session.user.email ?? undefined}
        className={cn(
          buttonClasses("ghost", "sm"),
          "gap-2 pl-1.5 pr-2.5",
          open && "bg-surface-muted",
        )}
      >
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={session.user.id ?? session.user.email ?? avatar}
            src={avatar}
            alt=""
            className="h-6 w-6 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-fg"
          >
            {initial}
          </span>
        )}
        <span className="hidden max-w-[8rem] truncate sm:inline">{label}</span>
        <span aria-hidden="true" className="text-xs">
          ▾
        </span>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account menu"
          className="absolute right-0 z-[120] mt-2 w-56 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-xl"
        >
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-sm font-medium">{label}</p>
            {session.user.email && (
              <p className="truncate text-xs text-fg-muted">{session.user.email}</p>
            )}
          </div>
          <Link
            role="menuitem"
            href="/account?tab=personal"
            onClick={handleClose}
            className="block px-3 py-2 text-sm hover:bg-surface-muted"
          >
            Personal settings
          </Link>
          <Link
            role="menuitem"
            href="/account?tab=app"
            onClick={handleClose}
            className="block px-3 py-2 text-sm hover:bg-surface-muted"
          >
            App settings
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              handleClose();
              void signOutToLanding();
            }}
            className="block w-full px-3 py-2 text-left text-sm text-danger hover:bg-surface-muted"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
