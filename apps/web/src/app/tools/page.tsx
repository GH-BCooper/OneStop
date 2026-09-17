import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardDescription, CardTitle } from "@onestop/ui";
import { PagePlaceholder } from "@/components/PagePlaceholder";
import { categories } from "@/lib/mock-data";

export const metadata: Metadata = { title: "All Tools" };

export default function ToolsPage() {
  return (
    <PagePlaceholder
      title="All Tools"
      description="Browse every OneStop tool by category. Search, filters and sorting arrive with the tool registry."
      phase="03-tool-registry.md"
    >
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {categories.map((c) => (
          <li key={c.slug}>
            <Link href={`/tools/${c.slug}`} className="block h-full rounded-lg">
              <Card interactive className="h-full">
                <CardTitle>
                  <span aria-hidden="true">{c.icon}</span> {c.name}
                </CardTitle>
                <CardDescription>{c.count} tools</CardDescription>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </PagePlaceholder>
  );
}
