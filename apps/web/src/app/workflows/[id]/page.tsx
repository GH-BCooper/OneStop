// `/workflows/[id]` — edit and run one saved workflow (15-workflows.md).
import type { Metadata } from "next";
import { WorkflowEditor } from "@/components/workflows/WorkflowEditor";

interface Props {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = { title: "Workflow" };

export default async function WorkflowPage({ params }: Props) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Workflow</h1>
        <p className="mt-2 text-fg-muted">Edit the steps, then run it on new files below.</p>
      </div>
      <WorkflowEditor id={id} />
    </div>
  );
}
