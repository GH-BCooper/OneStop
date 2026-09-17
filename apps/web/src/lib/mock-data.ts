// Static placeholders for the UI shell.
// TODO(03-tool-registry.md): replace categories and popular tools with registry data.
// TODO(14-history-favorites.md): replace recent jobs with persisted history.

export interface CategorySummary {
  slug: string;
  name: string;
  count: number;
  icon: string;
}

// The 8 categories of master doc §4 (docs/OneStop_MasterDoc.md). Counts are the tools listed
// for them in docs/OneStop_Features.md: Documents = Word + PowerPoint, Excel/CSV/Data =
// Excel + Data Conversion, Audio/Video = Audio + Video + Online Media,
// Utilities/Developer = Developer + Network + File Utilities.
export const categories: CategorySummary[] = [
  { slug: "pdf", name: "PDF", count: 26, icon: "📄" },
  { slug: "documents", name: "Documents, Word & PowerPoint", count: 25, icon: "📝" },
  { slug: "data", name: "Excel, CSV & Data", count: 38, icon: "📊" },
  { slug: "images", name: "Images", count: 28, icon: "🖼️" },
  { slug: "media", name: "Audio & Video", count: 35, icon: "🎬" },
  { slug: "qr", name: "QR", count: 15, icon: "🔳" },
  { slug: "ai", name: "AI", count: 16, icon: "✨" },
  { slug: "dev-utility", name: "Utilities & Developer", count: 42, icon: "🛠️" },
];

export interface ToolSummary {
  name: string;
  category: string;
  slug: string;
}

// Tool names as written in docs/OneStop_Features.md; mostly the §21 search examples.
export const popularTools: ToolSummary[] = [
  { name: "Merge PDF", category: "pdf", slug: "merge-pdf" },
  { name: "Image → PDF", category: "images", slug: "image-to-pdf" },
  { name: "Background Removal", category: "images", slug: "background-removal" },
  { name: "Video Compressor", category: "media", slug: "video-compressor" },
  { name: "CSV → JSON", category: "data", slug: "csv-to-json" },
  { name: "QR Code Generator", category: "qr", slug: "qr-code-generator" },
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
