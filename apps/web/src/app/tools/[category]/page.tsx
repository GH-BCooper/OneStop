import {
  CATEGORIES,
  getCategory,
  getGroup,
  GROUPS,
  toolsForCatalogPage,
  type ToolMeta,
} from "@onestop/tool-registry";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ToolCard } from "@/components/tools/ToolCard";

interface Props {
  params: Promise<{ category: string }>;
}

// Category pages exist for both the 12 registry categories and the 8 catalogue groups.
export function generateStaticParams() {
  return [...GROUPS.map((g) => g.id), ...CATEGORIES.map((c) => c.id)].map((category) => ({
    category,
  }));
}

export const dynamicParams = false;

function displayName(id: string): string | undefined {
  return getGroup(id)?.name ?? getCategory(id)?.name;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params;
  const name = displayName(category);
  return { title: name ? `${name} tools` : "Tools" };
}

export default async function CategoryPage({ params }: Props) {
  const { category } = await params;
  const name = displayName(category);
  const tools = toolsForCatalogPage(category);
  if (!name || tools.length === 0) notFound();

  const sections = [...new Set(tools.map((t) => t.subcategory))].map((sub) => ({
    sub,
    tools: tools.filter((t: ToolMeta) => t.subcategory === sub),
  }));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
          <Link href="/tools" className="hover:text-primary hover:underline">
            All Tools
          </Link>{" "}
          <span aria-hidden="true">/</span> {name}
        </nav>
        <h1 className="text-2xl font-bold sm:text-3xl">{name} tools</h1>
        <p className="text-fg-muted">
          {tools.length} tools.{" "}
          <Link href={`/tools?category=${category}`} className="text-primary hover:underline">
            Search and filter this category →
          </Link>
        </p>
      </div>

      {sections.map((section) => (
        <section key={section.sub} className="flex flex-col gap-3">
          {sections.length > 1 && <h2 className="text-xl font-semibold">{section.sub}</h2>}
          <ul
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            aria-label={section.sub}
          >
            {section.tools.map((t) => (
              <li key={t.id}>
                <ToolCard tool={t} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
