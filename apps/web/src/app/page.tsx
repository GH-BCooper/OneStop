import { Badge, buttonClasses, Card, CardDescription, CardTitle } from "@onestop/ui";
import Link from "next/link";
import { HomeSearch } from "@/components/home/HomeSearch";
import { categories, popularTools, recentJobs, type RecentJob } from "@/lib/mock-data";

const statusTone: Record<RecentJob["status"], "success" | "danger" | "primary"> = {
  completed: "success",
  failed: "danger",
  processing: "primary",
};

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
          {categories.map((c) => (
            <li key={c.slug}>
              <Link
                href={`/tools/${c.slug}`}
                className="block h-full rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Card interactive className="flex h-full items-center gap-3">
                  <span aria-hidden="true" className="text-2xl">
                    {c.icon}
                  </span>
                  <div className="min-w-0">
                    <CardTitle>{c.name}</CardTitle>
                    <CardDescription>{c.count} tools</CardDescription>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section aria-labelledby="popular-heading" className="flex flex-col gap-4">
          <h2 id="popular-heading" className="text-xl font-semibold">
            Popular tools
          </h2>
          <ul className="flex flex-wrap gap-2">
            {popularTools.map((t) => (
              <li key={t.slug}>
                <Link
                  href={`/tools/${t.category}/${t.slug}`}
                  className="inline-block rounded-full border border-border bg-surface px-3 py-1.5 text-sm hover:border-primary hover:text-primary"
                >
                  {t.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="jobs-heading" className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <h2 id="jobs-heading" className="text-xl font-semibold">
              Recent jobs
            </h2>
            <Badge>Sample data</Badge>
          </div>
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {recentJobs.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{j.tool}</p>
                    <p className="truncate text-xs text-fg-muted">
                      {j.file} · {j.when}
                    </p>
                  </div>
                  <Badge tone={statusTone[j.status]}>{j.status}</Badge>
                </li>
              ))}
            </ul>
          </Card>
          <p className="text-xs text-fg-muted">
            Shown for signed-in users. Real history arrives with accounts.
          </p>
        </section>
      </div>
    </div>
  );
}
