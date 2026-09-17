import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/PagePlaceholder";

export const metadata: Metadata = { title: "History" };

export default function HistoryPage() {
  return (
    <PagePlaceholder
      title="History"
      description="Your recent jobs and their results."
      phase="14-history-favorites.md"
    />
  );
}
