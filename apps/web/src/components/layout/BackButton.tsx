"use client";

// A back button on every screen except Home (item 4 of the redesign). It lives once in the root
// layout rather than in every page, so no route can forget it.
import { usePathname, useRouter } from "next/navigation";

export function BackButton() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/") return null;

  return (
    <button
      type="button"
      onClick={() => {
        // A tab opened straight on a deep link has nothing of this app to go back to; send it
        // home instead of leaving the browser's own history (a search engine, another site).
        if (typeof window !== "undefined" && window.history.length > 1) router.back();
        else router.push("/");
      }}
      aria-label="Go back"
      className="mb-4 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-fg-muted hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span aria-hidden="true">←</span>
      Back
    </button>
  );
}
