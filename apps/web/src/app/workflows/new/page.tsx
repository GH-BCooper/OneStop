import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/PagePlaceholder";

export const metadata: Metadata = { title: "New workflow" };

export default function NewWorkflowPage() {
  return (
    <PagePlaceholder
      title="New workflow"
      description="Pick tools, set their options and connect them into a reusable workflow."
      phase="15-workflows.md"
    />
  );
}
