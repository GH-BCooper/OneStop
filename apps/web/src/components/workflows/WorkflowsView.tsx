"use client";

// `/workflows` — the saved-workflow list (15-workflows.md).
//
// Like history and favourites, one component serves both audiences: a signed-in user's workflows
// come from `/api/workflows`, a guest's from localStorage, and both arrive as the same
// `Workflow[]`. The banner says which, so nobody has to guess where a workflow went.
import { getTool, WORKFLOW_TEMPLATES } from "@onestop/tool-registry";
import type { Workflow, WorkflowStep } from "@onestop/types";
import { Badge, Button, buttonClasses, Card, CardTitle } from "@onestop/ui";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  deleteLocalWorkflow,
  deleteRemoteWorkflow,
  fetchWorkflows,
  filterWorkflows,
  readLocalWorkflows,
  saveLocalWorkflow,
  saveRemoteWorkflow,
  setLocalFavorite,
  setRemoteFavorite,
  WORKFLOWS_CHANGED,
  type WorkflowFilter,
} from "@/lib/workflows";

const FILTERS: { id: WorkflowFilter; label: string; empty: string }[] = [
  { id: "all", label: "All", empty: "" },
  {
    id: "favorites",
    label: "Favourites",
    empty: "No favourites yet — tap the star on a workflow to add one.",
  },
  {
    id: "recent",
    label: "Recently used",
    empty: "Nothing has been run yet. Workflows you run will show up here.",
  },
  {
    id: "frequent",
    label: "Frequently used",
    empty: "No workflow has been run more than once yet.",
  },
];

function chainLabel(steps: WorkflowStep[]): string {
  return steps.map((s) => getTool(s.toolId)?.name ?? s.toolId).join(" → ");
}

export interface WorkflowsViewProps {
  accountsEnabled: boolean;
}

export function WorkflowsView({ accountsEnabled }: WorkflowsViewProps) {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const signedIn = Boolean(session?.user);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<WorkflowFilter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    if (signedIn) {
      try {
        setWorkflows(await fetchWorkflows());
      } catch {
        setWorkflows([]);
        setNotice("Your workflows could not be loaded. Check your connection and try again.");
      }
    } else {
      setWorkflows(readLocalWorkflows());
    }
    setLoading(false);
  }, [signedIn]);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    void load();
  }, [load, sessionStatus]);

  useEffect(() => {
    const handler = () => void load();
    window.addEventListener(WORKFLOWS_CHANGED, handler);
    return () => window.removeEventListener(WORKFLOWS_CHANGED, handler);
  }, [load]);

  const remove = async (workflow: Workflow) => {
    try {
      if (workflow.scope === "account") await deleteRemoteWorkflow(workflow.id);
      else deleteLocalWorkflow(workflow.id);
      setNotice(`"${workflow.name}" was deleted.`);
      await load();
    } catch {
      setNotice("That workflow could not be deleted. Please try again.");
    }
  };

  const toggleFavorite = async (workflow: Workflow) => {
    const favorite = !workflow.favorite;
    // Show the star straight away; put it back if the save fails.
    const mark = (value: boolean) =>
      setWorkflows((all) => all.map((w) => (w.id === workflow.id ? { ...w, favorite: value } : w)));
    mark(favorite);
    setNotice(null);
    try {
      if (workflow.scope === "account") await setRemoteFavorite(workflow.id, favorite);
      else setLocalFavorite(workflow.id, favorite);
    } catch (err) {
      mark(workflow.favorite);
      setNotice(
        err instanceof Error && err.message
          ? err.message
          : "That could not be saved. Please try again.",
      );
    }
  };

  const startFromTemplate = async (id: string) => {
    const template = WORKFLOW_TEMPLATES.find((t) => t.id === id);
    if (!template) return;
    const input = {
      name: template.name,
      description: template.description,
      steps: template.steps,
    };
    try {
      const saved = signedIn ? await saveRemoteWorkflow(input) : saveLocalWorkflow(input);
      router.push(`/workflows/${saved.id}`);
    } catch {
      setNotice("That template could not be saved. Please try again.");
    }
  };

  const visible = filterWorkflows(workflows, filter);
  const activeFilter = FILTERS.find((f) => f.id === filter) ?? FILTERS[0]!;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">
          {signedIn
            ? "Saved to your account and available on every device you sign in on."
            : accountsEnabled
              ? "Saved on this device. Sign in to keep your workflows across devices."
              : "Saved on this device."}
        </p>
        <Link href="/workflows/new" className={buttonClasses("primary", "md")}>
          New workflow
        </Link>
      </div>

      {notice ? (
        <p role="status" className="text-sm text-fg-muted">
          {notice}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : workflows.length === 0 ? (
        <Card className="flex flex-col gap-4">
          <CardTitle>No workflows yet</CardTitle>
          <p className="text-sm text-fg-muted">
            A workflow is an ordered chain of tools you can run again on new files. Start from one
            of these examples, or build your own.
          </p>
          <div className="flex flex-wrap gap-2">
            {WORKFLOW_TEMPLATES.map((template) => (
              <Button
                key={template.id}
                size="sm"
                variant="secondary"
                onClick={() => void startFromTemplate(template.id)}
              >
                {template.name}
              </Button>
            ))}
          </div>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter workflows">
            {FILTERS.map((f) => (
              <Button
                key={f.id}
                size="sm"
                variant={filter === f.id ? "primary" : "secondary"}
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </Button>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="text-sm text-fg-muted" data-testid="workflow-filter-empty">
              {activeFilter.empty}
            </p>
          ) : null}
          <ul className="flex flex-col gap-3" data-testid="workflow-list">
            {visible.map((workflow) => (
              <li key={workflow.id}>
                <Card className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/workflows/${workflow.id}`} className="font-semibold underline">
                        {workflow.name}
                      </Link>
                      <Badge tone={workflow.scope === "account" ? "primary" : "neutral"}>
                        {workflow.scope === "account" ? "Account" : "This device"}
                      </Badge>
                      <Badge tone="neutral">
                        {workflow.steps.length} step{workflow.steps.length === 1 ? "" : "s"}
                      </Badge>
                      {workflow.useCount > 0 ? (
                        <Badge tone="neutral">
                          Run {workflow.useCount} time{workflow.useCount === 1 ? "" : "s"}
                        </Badge>
                      ) : null}
                    </div>
                    {workflow.description ? (
                      <p className="text-sm text-fg-muted">{workflow.description}</p>
                    ) : null}
                    <p className="text-sm text-fg-muted">{chainLabel(workflow.steps)}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-pressed={workflow.favorite}
                      aria-label={
                        workflow.favorite
                          ? `Remove ${workflow.name} from favourites`
                          : `Add ${workflow.name} to favourites`
                      }
                      onClick={() => void toggleFavorite(workflow)}
                    >
                      {workflow.favorite ? "★" : "☆"}
                    </Button>
                    <Link
                      href={`/workflows/${workflow.id}?use=1`}
                      className={buttonClasses("primary", "sm")}
                    >
                      Use
                    </Link>
                    <Link
                      href={`/workflows/${workflow.id}`}
                      className={buttonClasses("secondary", "sm")}
                    >
                      Open
                    </Link>
                    <Button size="sm" variant="ghost" onClick={() => void remove(workflow)}>
                      Delete
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
