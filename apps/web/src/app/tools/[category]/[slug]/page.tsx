import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/PagePlaceholder";
import { findCategory, titleFromSlug } from "@/lib/mock-data";

interface Props {
  params: Promise<{ category: string; slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: titleFromSlug(slug) };
}

export default async function ToolPage({ params }: Props) {
  const { category, slug } = await params;
  const categoryName = findCategory(category)?.name ?? titleFromSlug(category);
  return (
    <PagePlaceholder
      title={titleFromSlug(slug)}
      description={`A ${categoryName} tool. Upload, options and results will appear here.`}
      phase="03-tool-registry.md"
    />
  );
}
