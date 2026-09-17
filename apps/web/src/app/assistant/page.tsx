import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/PagePlaceholder";

export const metadata: Metadata = { title: "AI Assistant" };

export default function AssistantPage() {
  return (
    <PagePlaceholder
      title="AI Assistant"
      description="Describe a task in plain language and OneStop will plan and run the tools for you."
      phase="16-ai-assistant.md"
    />
  );
}
