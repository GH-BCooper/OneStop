import { Card } from "@onestop/ui";
import type { ReactNode } from "react";

export interface PagePlaceholderProps {
  title: string;
  description: string;
  /** Build file that delivers this page, e.g. "15-workflows.md". */
  phase?: string;
  children?: ReactNode;
}

export function PagePlaceholder({ title, description, phase, children }: PagePlaceholderProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        <p className="mt-2 text-fg-muted">{description}</p>
      </div>
      {children}
      {phase && (
        <Card className="border-dashed text-sm text-fg-muted">
          Coming soon. This page is built in <code className="font-mono">{phase}</code>.
        </Card>
      )}
    </div>
  );
}
