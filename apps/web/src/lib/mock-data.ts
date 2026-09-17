// Static placeholders for parts of the UI shell that have no real data source yet.
// Categories and tool lists now come from `@onestop/tool-registry` (03-tool-registry.md).
// TODO(14-history-favorites.md): replace recent jobs with persisted history.

export interface RecentJob {
  id: string;
  tool: string;
  file: string;
  status: "completed" | "failed" | "processing";
  when: string;
}

export const recentJobs: RecentJob[] = [
  { id: "job-1042", tool: "Merge PDF", file: "q3-report.pdf", status: "completed", when: "2h ago" },
  {
    id: "job-1041",
    tool: "Compress Image",
    file: "banner.png",
    status: "completed",
    when: "Yesterday",
  },
  { id: "job-1039", tool: "Video to MP3", file: "talk.mp4", status: "failed", when: "3 days ago" },
];
