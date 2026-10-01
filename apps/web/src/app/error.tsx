"use client";
// The error boundary for every page: a short, actionable message and a retry. The technical detail
// stays in the server log and the console, never on screen (CLAUDE.md §7).
import Link from "next/link";
import { useEffect } from "react";
import { buttonClasses } from "@onestop/ui";
import { EmptyState } from "@/components/fx/EmptyState";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-10">
      <EmptyState
        kind="error"
        title="Something went wrong on this page"
        description="It's not your files or your account. Try again, and if it keeps happening, go back to the home page and start again."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className={buttonClasses("primary")} onClick={() => reset()}>
              Try again
            </button>
            <Link href="/" className={buttonClasses("secondary")}>
              Go home
            </Link>
          </div>
        }
      />
    </div>
  );
}
