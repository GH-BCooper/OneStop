// `/assistant` — one of OneStop's two front doors (master plan §3.1, §7; 16-ai-assistant.md).
import type { Metadata } from "next";
import { AssistantView } from "@/components/assistant/AssistantView";

export const metadata: Metadata = {
  title: "AI Assistant",
  description:
    "Describe a task in plain language and OneStop will plan and run the right tools for you.",
};

export default function AssistantPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <h1 className="sr-only">AI Assistant</h1>
      <AssistantView />
    </div>
  );
}
