"use client";

// One step of a workflow (15-workflows.md).
//
// The tool picker is built from the registry, never from a hand-written list, and it defaults to
// showing only the tools that can actually accept the previous step's output — so the commonest
// way to build a broken chain is simply not offered. The "show every tool" toggle is there because
// the registry is the source of truth, not a straitjacket: pick an incompatible tool and the
// builder tells you exactly why it cannot work.
import {
  compatibleTypes,
  getTool,
  getToolOptions,
  fileInputTypes,
  inputKind,
  tools,
  typeLabel,
  type ToolMeta,
} from "@onestop/tool-registry";
import type { WorkflowIssue, WorkflowStep } from "@onestop/types";
import { Badge, Button, Card } from "@onestop/ui";
import { useId, useMemo, useState } from "react";
import { ToolOptions, type OptionValues } from "@/components/tools/ToolOptions";

const selectClasses =
  "h-10 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-fg " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

/** Tools that can be a workflow step at all: built, and able to take a file. */
export function chainableTools(): ToolMeta[] {
  return tools
    .filter((t) => t.status === "available" && inputKind(t) === "file")
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Of those, the ones that can follow `previous` (or all of them, at the start of a chain). */
export function toolsAfter(previous: ToolMeta | undefined): ToolMeta[] {
  const all = chainableTools();
  if (!previous) return all;
  return all.filter((t) => compatibleTypes(previous, t).length > 0);
}

export interface StepEditorProps {
  index: number;
  stepCount: number;
  step: WorkflowStep;
  /** The tool the step before this one runs, for the compatibility filter. */
  previous: ToolMeta | undefined;
  issues: WorkflowIssue[];
  disabled?: boolean;
  onChange(step: WorkflowStep): void;
  onMove(direction: -1 | 1): void;
  onRemove(): void;
}

export function StepEditor({
  index,
  stepCount,
  step,
  previous,
  issues,
  disabled = false,
  onChange,
  onMove,
  onRemove,
}: StepEditorProps) {
  const fieldId = useId();
  const [showAll, setShowAll] = useState(false);
  const tool = getTool(step.toolId);

  const choices = useMemo(() => {
    const list = showAll ? chainableTools() : toolsAfter(previous);
    // The chosen tool always stays in the list, even when it is the incompatible one.
    return tool && !list.some((t) => t.id === tool.id) ? [tool, ...list] : list;
  }, [showAll, previous, tool]);

  const options = tool ? getToolOptions(tool.id) : [];
  const values = (step.options ?? {}) as OptionValues;

  const setOption = (id: string, value: string | number | boolean) => {
    onChange({ ...step, options: { ...(step.options ?? {}), [id]: value } });
  };

  return (
    <Card className="flex flex-col gap-4" data-testid={`workflow-step-${index}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone="neutral">Step {index + 1}</Badge>
          {tool ? <Badge tone="primary">{tool.category}</Badge> : null}
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || index === 0}
            aria-label={`Move step ${index + 1} up`}
            onClick={() => onMove(-1)}
          >
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || index === stepCount - 1}
            aria-label={`Move step ${index + 1} down`}
            onClick={() => onMove(1)}
          >
            ↓
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            aria-label={`Remove step ${index + 1}`}
            onClick={onRemove}
          >
            ✕
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId} className="text-sm font-medium">
          Tool
        </label>
        <select
          id={fieldId}
          className={selectClasses}
          disabled={disabled}
          value={step.toolId}
          onChange={(e) => onChange({ toolId: e.target.value })}
        >
          <option value="">Choose a tool…</option>
          {choices.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {previous ? (
          <label className="mt-1 flex items-center gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={showAll}
              disabled={disabled}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            Show every tool, not only the ones that fit {previous.name}
          </label>
        ) : null}
      </div>

      {tool ? (
        <p className="text-sm text-fg-muted">
          {tool.description} Takes {typeLabel(fileInputTypes(tool))}; produces{" "}
          {typeLabel(tool.outputTypes)}.
        </p>
      ) : null}

      {issues.length > 0 ? (
        <ul className="flex flex-col gap-1" data-testid={`workflow-step-${index}-issues`}>
          {issues.map((issue) => (
            <li key={issue.code + issue.message} role="alert" className="text-sm text-danger">
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      {tool && options.length > 0 ? (
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Options</summary>
          <div className="mt-3">
            <ToolOptions
              options={options}
              values={values}
              disabled={disabled}
              onChange={setOption}
            />
          </div>
        </details>
      ) : null}
    </Card>
  );
}
