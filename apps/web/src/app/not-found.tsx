// The 404 page: shown for any address that matches nothing, with a way back that is not a dead end.
import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@onestop/ui";
import { EmptyState } from "@/components/fx/EmptyState";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-10">
      <EmptyState
        kind="no-results"
        title="We couldn't find that page"
        description="The link may be out of date, or the tool may have moved. Search the catalogue or head back home."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/tools" className={buttonClasses("primary")}>
              Browse all tools
            </Link>
            <Link href="/" className={buttonClasses("secondary")}>
              Go home
            </Link>
          </div>
        }
      />
    </div>
  );
}
