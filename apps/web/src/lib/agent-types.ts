// What the agent stream sends the chat, and what a chat turn keeps of it (see /api/assistant/agent).
import type { AgentClientAction, AgentOutput } from "@onestop/api";
import type { OutputFileRef } from "@onestop/types";

export interface AgentStepView {
  id: number;
  label: string;
  toolId?: string;
  status: "running" | "done" | "failed";
  detail?: string;
}

export interface AgentTurnData {
  steps: AgentStepView[];
  message: string | null;
  files: OutputFileRef[];
  outputs: AgentOutput[];
  actions: AgentClientAction[];
  model: string | null;
}
