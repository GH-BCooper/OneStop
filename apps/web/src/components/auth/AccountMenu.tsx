"use client";

// Header entry point for accounts (13-auth-database.md). A guest sees "Sign in"; a signed-in
// visitor sees their name. Nothing here blocks a tool - accounts are optional everywhere.
import { buttonClasses } from "@onestop/ui";
import { useSession } from "next-auth/react";
import Link from "next/link";

/** Mounted by the header only when accounts are configured, so it can rely on the session. */
export function AccountMenu() {
  const { data: session, status } = useSession();

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

  const label = session.user.name?.trim() || session.user.email || "Account";
  return (
    <Link
      href="/account"
      className={buttonClasses("ghost", "sm")}
      title={session.user.email ?? undefined}
    >
      <span className="max-w-[10rem] truncate">{label}</span>
    </Link>
  );
}
