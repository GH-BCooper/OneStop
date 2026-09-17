import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/PagePlaceholder";

export const metadata: Metadata = { title: "Status" };

export default function StatusPage() {
  return (
    <PagePlaceholder
      title="Status"
      description="Which tools work right now, including offline availability."
      phase="18-pwa-offline.md"
    />
  );
}
