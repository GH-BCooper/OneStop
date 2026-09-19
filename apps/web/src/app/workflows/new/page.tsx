// `/workflows/new` — the builder (15-workflows.md).
import type { Metadata } from "next";
import { WorkflowBuilder } from "@/components/workflows/WorkflowBuilder";

export const metadata: Metadata = { title: "New workflow" };

export default function NewWorkflowPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">New workflow</h1>
        <p className="mt-2 text-fg-muted">
          Pick tools, set their options and connect them into a reusable chain. Each step has to be
          able to read what the step before it produces — the builder says so as you go.
        </p>
      </div>
      <WorkflowBuilder />
    </div>
  );
}
