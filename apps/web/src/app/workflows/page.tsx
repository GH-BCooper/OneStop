import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/PagePlaceholder";

export const metadata: Metadata = { title: "Workflows" };

export default function WorkflowsPage() {
  return (
    <PagePlaceholder
      title="Workflows"
      description="Save chains of tools and run them again on new files."
      phase="15-workflows.md"
    />
  );
}
