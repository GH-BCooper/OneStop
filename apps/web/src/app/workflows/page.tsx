// `/workflows` — saved tool chains (15-workflows.md).
import type { Metadata } from "next";
import { WorkflowsView } from "@/components/workflows/WorkflowsView";
import { authIsConfigured } from "@/lib/auth-config";

export const metadata: Metadata = { title: "Workflows" };

export default function WorkflowsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Workflows</h1>
        <p className="mt-2 text-fg-muted">
          Save chains of tools and run them again on new files. Each step is an ordinary OneStop
          tool, so a workflow can do anything the tools can — one after another, on one file or on a
          whole batch.
        </p>
      </div>
      <WorkflowsView accountsEnabled={authIsConfigured()} />
    </div>
  );
}
