// `/workflows/[id]` — edit and run one saved workflow (15-workflows.md).
import type { Metadata } from "next";
import { WorkflowEditor } from "@/components/workflows/WorkflowEditor";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ use?: string }>;
}

export const metadata: Metadata = { title: "Workflow" };

export default async function WorkflowPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { use } = await searchParams;
  const useOnly = use === "1";
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{useOnly ? "Run workflow" : "Workflow"}</h1>
        <p className="mt-2 text-fg-muted">
          {useOnly
            ? "Drop your files in and run it."
            : "Edit the steps, then run it on new files below."}
        </p>
      </div>
      <WorkflowEditor id={id} useOnly={useOnly} />
    </div>
  );
}
