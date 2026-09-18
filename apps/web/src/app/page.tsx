import { GROUPS, toolsForCatalogPage } from "@onestop/tool-registry";
import { buttonClasses, Card, CardDescription, CardTitle } from "@onestop/ui";
import Link from "next/link";
import { HomeSearch } from "@/components/home/HomeSearch";
import { PopularTools } from "@/components/home/PopularTools";
import { RecentJobs } from "@/components/home/RecentJobs";
import { RecentTools } from "@/components/home/RecentTools";

export default function HomePage() {
  return (
    <div className="flex flex-col gap-12">
      <section
        aria-labelledby="home-heading"
        className="flex flex-col items-center gap-6 pt-4 text-center"
      >
        <h1 id="home-heading" className="text-3xl font-bold tracking-tight sm:text-5xl">
          What do you want to do?
        </h1>
        <p className="max-w-2xl text-fg-muted">
          Convert, edit and inspect files with free, local-first tools, or describe the task and let
          the assistant chain the right tools for you.
        </p>
        <div className="w-full max-w-3xl">
          <HomeSearch />
        </div>
        <Link href="/assistant" className={buttonClasses("primary", "lg")}>
          <span aria-hidden="true">✨</span>
          Ask OneStop AI
        </Link>
      </section>

      <section aria-labelledby="categories-heading" className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="categories-heading" className="text-xl font-semibold">
            Categories
          </h2>
          <Link href="/tools" className="text-sm text-primary hover:underline">
            All tools →
          </Link>
        </div>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {GROUPS.map((c) => (
            <li key={c.id}>
              <Link
                href={`/tools/${c.id}`}
                className="block h-full rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Card interactive className="flex h-full items-center gap-3">
                  <span aria-hidden="true" className="text-2xl">
                    {c.icon}
                  </span>
                  <div className="min-w-0">
                    <CardTitle>{c.name}</CardTitle>
                    <CardDescription>{toolsForCatalogPage(c.id).length} tools</CardDescription>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <RecentTools />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Both panels now read real usage and real history (14-history-favorites.md). */}
        <PopularTools />
        <RecentJobs />
      </div>
    </div>
  );
}
