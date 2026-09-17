// Features §15 (Workflow Tools) are capabilities of the workflow builder, not standalone tools,
// so they map to /workflows routes instead of registry entries (see PROGRESS.md, phase 03).
import type { PlatformFeature } from "./schema";

const phase = "15-workflows.md";

export const PLATFORM_FEATURES: PlatformFeature[] = [
  { name: "Create Workflow", route: "/workflows/new", phase, sources: ["15.1"] },
  { name: "Save Workflow", route: "/workflows/new", phase, sources: ["15.2"] },
  { name: "Edit Workflow", route: "/workflows/[id]", phase, sources: ["15.3"] },
  { name: "Delete Workflow", route: "/workflows", phase, sources: ["15.4"] },
  { name: "Run Workflow", route: "/workflows/[id]", phase, sources: ["15.5"] },
  { name: "Duplicate Workflow", route: "/workflows", phase, sources: ["15.6"] },
  { name: "Multi-step File Processing", route: "/workflows/new", phase, sources: ["15.7"] },
  { name: "Batch Processing", route: "/workflows", phase, sources: ["15.8"] },
];
