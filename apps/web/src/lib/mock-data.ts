// Static placeholders for the UI shell.
// TODO(03-tool-registry.md): replace categories and popular tools with registry data.
// TODO(14-history-favorites.md): replace recent jobs with persisted history.

export interface CategorySummary {
  slug: string;
  name: string;
  count: number;
  icon: string;
}

export const categories: CategorySummary[] = [
  { slug: "pdf", name: "PDF", count: 32, icon: "📄" },
  { slug: "documents", name: "Word & PowerPoint", count: 24, icon: "📝" },
  { slug: "data", name: "Excel, CSV & Data", count: 28, icon: "📊" },
  { slug: "images", name: "Images", count: 36, icon: "🖼️" },
  { slug: "media", name: "Audio & Video", count: 30, icon: "🎬" },
  { slug: "qr", name: "QR Codes", count: 10, icon: "🔳" },
  { slug: "ai", name: "AI Tools", count: 18, icon: "✨" },
  { slug: "dev-utility", name: "Developer & File Utilities", count: 40, icon: "🛠️" },
];

export interface ToolSummary {
  name: string;
  category: string;
  slug: string;
}

export const popularTools: ToolSummary[] = [
  { name: "Merge PDF", category: "pdf", slug: "merge-pdf" },
  { name: "Compress Image", category: "images", slug: "compress-image" },
  { name: "PDF to Word", category: "pdf", slug: "pdf-to-word" },
  { name: "CSV to Excel", category: "data", slug: "csv-to-excel" },
  { name: "QR Code Generator", category: "qr", slug: "qr-generator" },
  { name: "JSON Formatter", category: "dev-utility", slug: "json-formatter" },
];

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

export function findCategory(slug: string): CategorySummary | undefined {
  return categories.find((c) => c.slug === slug);
}

/** "merge-pdf" → "Merge Pdf"; good enough for placeholder headings. */
export function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
