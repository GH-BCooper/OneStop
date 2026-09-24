"use client";

// The workflow builder (15-workflows.md): `/workflows/new` and `/workflows/[id]`.
//
// Validation runs on every edit, in the browser, against the same registry rules the server
// applies on save and on run (`packages/tool-registry/src/workflows.ts`). That is the whole point
// of the phase's "reject incompatible chains at build time" requirement: you find out that Remove
// Background cannot feed an audio tool while you are still building, not after uploading a file.
import {
  getTool,
  validateWorkflow,
  WORKFLOW_TEMPLATES,
  type ToolMeta,
} from "@onestop/tool-registry";
import type { Workflow, WorkflowIssue, WorkflowStep } from "@onestop/types";
import { Badge, Button, Card, Input } from "@onestop/ui";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  deleteLocalWorkflow,
  deleteRemoteWorkflow,
  recordLocalUse,
  saveLocalWorkflow,
  saveRemoteWorkflow,
} from "@/lib/workflows";
import { StepEditor, toolsAfter } from "./StepEditor";
import { WorkflowRunner } from "./WorkflowRunner";

export interface WorkflowBuilderProps {
  /** An existing workflow to edit, or undefined for a new one. */
  workflow?: Workflow;
  /** Show only the run card — no step editing — for the "Use" flow from the workflow list. */
  useOnly?: boolean;
}

function issuesForStep(issues: WorkflowIssue[], index: number): WorkflowIssue[] {
  return issues.filter((i) => i.stepIndex === index);
}

export function WorkflowBuilder({ workflow, useOnly = false }: WorkflowBuilderProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const signedIn = Boolean(session?.user);

  const [name, setName] = useState(workflow?.name ?? "");
  const [description, setDescription] = useState(workflow?.description ?? "");
  const [steps, setSteps] = useState<WorkflowStep[]>(workflow?.steps ?? []);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validation = useMemo(
    () => validateWorkflow(steps, { checkName: true, name, description }),
    [steps, name, description],
  );
  const generalIssues = validation.issues.filter((i) => i.stepIndex === null);
  const runnable = steps.length > 0 && validation.issues.every((i) => i.code === "INVALID_NAME");

  const previousTool = (index: number): ToolMeta | undefined =>
    index === 0 ? undefined : getTool(steps[index - 1]?.toolId ?? "");

  const addStep = () => {
    const suggestion = toolsAfter(previousTool(steps.length))[0];
    setSteps([...steps, { toolId: suggestion?.id ?? "" }]);
    setNotice(null);
  };

  const patchStep = (index: number, next: WorkflowStep) => {
    setSteps(steps.map((s, i) => (i === index ? next : s)));
    setNotice(null);
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setSteps(next);
    setNotice(null);
  };

  const removeStep = (index: number) => {
    setSteps(steps.filter((_, i) => i !== index));
    setNotice(null);
  };

  const useTemplate = (id: string) => {
    const template = WORKFLOW_TEMPLATES.find((t) => t.id === id);
    if (!template) return;
    setName(template.name);
    setDescription(template.description);
    setSteps(template.steps.map((s) => ({ ...s, options: { ...(s.options ?? {}) } })));
    setNotice(null);
    setError(null);
  };

  const save = async () => {
    if (notice) {
      router.push("/workflows");
      return;
    }
    if (!validation.valid) {
      setError(validation.issues[0]?.message ?? "This workflow cannot be saved yet.");
      return;
    }
    setSaving(true);
    setError(null);
    const input = { name: name.trim(), description: description.trim() || null, steps };
    try {
      if (signedIn) {
        const saved = await saveRemoteWorkflow(
          input,
          workflow?.scope === "account" ? workflow.id : undefined,
        );
        setNotice("Saved to your account.");
        if (!workflow) router.push(`/workflows/${saved.id}`);
      } else {
        const saved = saveLocalWorkflow(
          input,
          workflow?.scope === "device" ? workflow.id : undefined,
        );
        setNotice("Saved on this device. Sign in to keep it across devices.");
        if (!workflow) router.push(`/workflows/${saved.id}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!workflow) return;
    setSaving(true);
    try {
      if (workflow.scope === "account") await deleteRemoteWorkflow(workflow.id);
      else deleteLocalWorkflow(workflow.id);
      router.push("/workflows");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be deleted.");
      setSaving(false);
    }
  };

  if (useOnly) {
    return (
      <div className="flex flex-col gap-6">
        <Card className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{name || "Workflow"}</h2>
            <Badge tone="neutral">
              {steps.length} step{steps.length === 1 ? "" : "s"}
            </Badge>
          </div>
          {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
          {workflow ? (
            <Link href={`/workflows/${workflow.id}`} className="text-sm text-fg-muted underline">
              Edit this workflow
            </Link>
          ) : null}
        </Card>
        {runnable ? (
          <WorkflowRunner
            steps={steps}
            name={name.trim() || "Workflow"}
            workflowId={workflow?.scope === "account" ? workflow.id : null}
            onSuccess={() => {
              if (workflow?.scope === "device") recordLocalUse(workflow.id);
            }}
          />
        ) : (
          <p className="text-sm text-danger">This workflow has an issue and cannot be run.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="workflow-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="workflow-name"
              value={name}
              placeholder="Scans to a shareable PDF"
              disabled={saving}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="workflow-description" className="text-sm font-medium">
              Description <span className="text-fg-muted">(optional)</span>
            </label>
            <Input
              id="workflow-description"
              value={description}
              placeholder="What this chain is for"
              disabled={saving}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        {steps.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-fg-muted">
              Start from one of the examples, or add your first step.
            </p>
            <div className="flex flex-wrap gap-2">
              {WORKFLOW_TEMPLATES.map((template) => (
                <Button
                  key={template.id}
                  size="sm"
                  variant="secondary"
                  onClick={() => useTemplate(template.id)}
                >
                  {template.name}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      <div className="flex flex-col gap-4">
        {steps.map((step, index) => (
          <StepEditor
            key={`${index}-${step.toolId}`}
            index={index}
            stepCount={steps.length}
            step={step}
            previous={previousTool(index)}
            issues={issuesForStep(validation.issues, index)}
            disabled={saving}
            onChange={(next) => patchStep(index, next)}
            onMove={(direction) => moveStep(index, direction)}
            onRemove={() => removeStep(index)}
          />
        ))}
      </div>

      {generalIssues.length > 0 ? (
        <ul className="flex flex-col gap-1" data-testid="workflow-issues">
          {generalIssues.map((issue) => (
            <li key={issue.code + issue.message} role="alert" className="text-sm text-danger">
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={saving} onClick={addStep}>
          + Add step
        </Button>
        <Button disabled={saving || !validation.valid} onClick={() => void save()}>
          {workflow ? "Save changes" : "Save workflow"}
        </Button>
        {workflow ? (
          <Button variant="danger" disabled={saving} onClick={() => void remove()}>
            Delete
          </Button>
        ) : null}
        <Link href="/workflows" className="text-sm text-fg-muted underline">
          Back to workflows
        </Link>
        {validation.valid ? <Badge tone="success">Chain is valid</Badge> : null}
      </div>

      {notice ? (
        <p role="status" className="text-sm text-fg-muted">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {runnable ? (
        <WorkflowRunner
          steps={steps}
          name={name.trim() || "Workflow"}
          workflowId={workflow?.scope === "account" ? workflow.id : null}
            onSuccess={() => {
              if (workflow?.scope === "device") recordLocalUse(workflow.id);
            }}
        />
      ) : null}
    </div>
  );
}
