import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/PagePlaceholder";

interface Props {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = { title: "Workflow" };

export default async function WorkflowPage({ params }: Props) {
  const { id } = await params;
  return (
    <PagePlaceholder
      title={`Workflow ${id}`}
      description="View, edit and run this workflow."
      phase="15-workflows.md"
    />
  );
}
