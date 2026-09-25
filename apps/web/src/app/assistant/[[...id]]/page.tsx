// `/assistant` (new chat) and `/assistant/<threadId>` (a saved thread) — one of OneStop's two front
// doors (master plan §3.1, §7; 16-ai-assistant.md). A single optional catch-all route keeps both
// URLs on the same page component, which is what lets `AssistantView` stay mounted (and an in-flight
// plan/run keep going) across the exact moment a brand-new chat gets its first URL.
import type { Metadata } from "next";
import { AssistantView } from "@/components/assistant/AssistantView";

export const metadata: Metadata = {
  title: "AI Assistant",
  description:
    "Describe a task in plain language and OneStop will plan and run the right tools for you.",
};

export default function AssistantPage() {
  return (
    <>
      <h1 className="sr-only">AI Assistant</h1>
      <AssistantView />
    </>
  );
}
