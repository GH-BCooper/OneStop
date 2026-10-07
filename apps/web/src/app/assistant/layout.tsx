// `/assistant` and `/assistant/<id>` share this shell: a collapsible chat-history sidebar next to
// whichever thread is open (see `components/assistant/ThreadSidebar.tsx`).
import type { ReactNode } from "react";
import { ThreadSidebar } from "@/components/assistant/ThreadSidebar";

export default function AssistantLayout({ children }: { children: ReactNode }) {
  return (
    <div className="assistant-layout-shell relative flex gap-4 max-lg:flex-col max-lg:gap-2 max-lg:pt-5">
      <ThreadSidebar />
      <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-6">{children}</div>
    </div>
  );
}
