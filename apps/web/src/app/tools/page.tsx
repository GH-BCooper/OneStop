import { GROUPS, toolsForCatalogPage, tools } from "@onestop/tool-registry";
import { Card, CardDescription, CardTitle } from "@onestop/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { ToolsExplorer } from "@/components/tools/ToolsExplorer";
import { parseExplorerParams } from "@/lib/tool-search-params";

export const metadata: Metadata = { title: "All Tools" };

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ToolsPage({ searchParams }: Props) {
  const initial = parseExplorerParams((await searchParams) ?? {});

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">All Tools</h1>
        <p className="mt-2 text-fg-muted">
          {tools.length} tools across {GROUPS.length} categories. Search by what you want to do —
          “make a pdf from images” works as well as a tool name.
        </p>
      </div>

      <nav aria-label="Categories">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {GROUPS.map((g) => (
            <li key={g.id}>
              <Link href={`/tools/${g.id}`} className="block h-full rounded-lg">
                <Card interactive className="h-full">
                  <CardTitle>
                    <span aria-hidden="true">{g.icon}</span> {g.name}
                  </CardTitle>
                  <CardDescription>{toolsForCatalogPage(g.id).length} tools</CardDescription>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <ToolsExplorer initial={initial} />
    </div>
  );
}
