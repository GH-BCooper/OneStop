"use client";

// `/workflows/[id]` (15-workflows.md).
//
// The id can belong to either store — an account workflow in Postgres or one kept on this device
// — and only the browser knows which, so the lookup happens here rather than on the server: the
// account is asked first when signed in, and this device's localStorage is the fallback. That also
// means an account workflow and a device workflow open in exactly the same editor.
import type { Workflow } from "@onestop/types";
import { Button } from "@onestop/ui";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchWorkflow, getLocalWorkflow } from "@/lib/workflows";
import { WorkflowBuilder } from "./WorkflowBuilder";

export interface WorkflowEditorProps {
  id: string;
  /** Show only the run card — no step editing — for the "Use" flow from the workflow list. */
  useOnly?: boolean;
}

export function WorkflowEditor({ id, useOnly = false }: WorkflowEditorProps) {
  const { data: session, status: sessionStatus } = useSession();
  const signedIn = Boolean(session?.user);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    if (sessionStatus === "loading") return;
    let cancelled = false;
    const load = async () => {
      const local = getLocalWorkflow(id);
      let found: Workflow | null = local ?? null;
      if (!found && signedIn) {
        try {
          found = await fetchWorkflow(id);
        } catch {
          found = null;
        }
      }
      if (cancelled) return;
      setWorkflow(found);
      setState(found ? "ready" : "missing");
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, signedIn, sessionStatus]);

  if (state === "loading") return <p className="text-sm text-fg-muted">Loading…</p>;

  if (state === "missing" || !workflow) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-fg-muted">
          That workflow does not exist, or it was saved on another device.
        </p>
        <Link href="/workflows">
          <Button variant="secondary">Back to workflows</Button>
        </Link>
      </div>
    );
  }

  return <WorkflowBuilder workflow={workflow} useOnly={useOnly} />;
}
