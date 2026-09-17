import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/PagePlaceholder";
import { findCategory, titleFromSlug } from "@/lib/mock-data";

interface Props {
  params: Promise<{ category: string }>;
}

async function categoryName(params: Props["params"]): Promise<string> {
  const { category } = await params;
  return findCategory(category)?.name ?? titleFromSlug(category);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: await categoryName(params) };
}

export default async function CategoryPage({ params }: Props) {
  const name = await categoryName(params);
  return (
    <PagePlaceholder
      title={`${name} tools`}
      description={`Every tool in the ${name} category.`}
      phase="03-tool-registry.md"
    />
  );
}
