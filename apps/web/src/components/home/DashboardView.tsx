"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { HomeSearch } from "@/components/home/HomeSearch";
import { PopularTools } from "@/components/home/PopularTools";
import { RecentJobs } from "@/components/home/RecentJobs";
import { RecentTools } from "@/components/home/RecentTools";

export interface DashboardGroup {
  id: string;
  name: string;
  icon: string;
  blurb: string;
  count: number;
}

function HeroAssistant({ greeting, desktop = false }: { greeting: string; desktop?: boolean }) {
  return (
    <section
      aria-labelledby="home-heading"
      className={`dashboard-hero relative overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-[var(--os-card-shadow)] ${
        desktop ? "lg:p-8" : ""
      }`}
    >
      <div className="dashboard-hero-glow" aria-hidden="true" />
      <div className="relative flex flex-col gap-4">
        <div className="max-w-3xl">
          <p className="mb-2 text-sm font-medium text-primary">
            OneStop — your local-first workspace
          </p>
          <h1 id="home-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
            {greeting}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-muted sm:text-base">
            One place to convert, create, and automate your files — privately and fast.
          </p>
        </div>
        <HomeSearch />
      </div>
    </section>
  );
}

function CategoryCards({
  groups,
  desktop = false,
}: {
  groups: DashboardGroup[];
  desktop?: boolean;
}) {
  return (
    <section aria-labelledby="categories-heading" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 id="categories-heading" className="text-xl font-semibold tracking-tight">
            All tools
          </h2>
          <p className="mt-1 text-sm text-fg-muted">Everything you need, organised by task.</p>
        </div>
        <Link href="/tools" className="shrink-0 text-sm font-medium text-primary hover:underline">
          Browse all <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div className={desktop ? "grid grid-cols-2 gap-3 xl:grid-cols-3" : "grid grid-cols-1 gap-2"}>
        {groups.map((group) => (
          <Link
            key={group.id}
            href={`/tools/${group.id}`}
            className="group flex min-w-0 items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 shadow-sm transition-[transform,border-color,background-color] duration-200 hover:-translate-y-0.5 hover:border-primary hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-xl"
            >
              {group.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{group.name}</span>
              <span className="mt-0.5 block line-clamp-1 text-xs text-fg-muted">{group.blurb}</span>
              <span className="mt-1 block text-xs font-medium text-fg-muted">
                {group.count} tools
              </span>
            </span>
            <span
              aria-hidden="true"
              className="shrink-0 text-fg-muted transition-transform group-hover:translate-x-0.5"
            >
              →
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function DesktopDashboard({ greeting, groups }: { greeting: string; groups: DashboardGroup[] }) {
  return (
    <div className="mx-auto hidden max-w-7xl gap-8 md:grid md:grid-cols-[12.5rem_minmax(0,1fr)]">
      <aside className="sticky top-20 hidden h-fit rounded-xl border border-border bg-surface p-3 shadow-[var(--os-card-shadow)] md:block">
        <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-[0.12em] text-fg-muted">
          Workspace
        </p>
        <nav aria-label="Dashboard sections" className="flex flex-col gap-1">
          {(
            [
              ["✨", "AI Assistant", "/assistant"],
              ["🧰", "All tools", "/tools"],
              ["🔁", "Workflows", "/workflows"],
              ["🕘", "History", "/history"],
            ] as const
          ).map(([icon, label, href]) => (
            <Link
              key={href}
              href={href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-fg-muted hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span aria-hidden="true" className="mr-2">
                {icon}
              </span>
              {label}
            </Link>
          ))}
        </nav>
        <div className="my-3 border-t border-border" />
        <a
          href="#quick-access"
          className="block rounded-lg px-3 py-2 text-sm text-fg-muted hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          ★ Favourites
        </a>
        <a
          href="#recent-tools"
          className="block rounded-lg px-3 py-2 text-sm text-fg-muted hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          ◷ Recently used
        </a>
      </aside>
      <div className="flex min-w-0 flex-col gap-8">
        <HeroAssistant greeting={greeting} desktop />
        <RecentTools />
        <CategoryCards groups={groups} desktop />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <PopularTools />
          <RecentJobs />
        </div>
      </div>
    </div>
  );
}

function MobileDashboard({ greeting, groups }: { greeting: string; groups: DashboardGroup[] }) {
  return (
    <div className="flex flex-col gap-7 md:hidden">
      <HeroAssistant greeting={greeting} />
      <RecentTools />
      <CategoryCards groups={groups} />
      <PopularTools />
      <RecentJobs />
    </div>
  );
}

/**
 * The two dashboard layouts are intentionally separate components. Only the matching tree mounts:
 * this avoids duplicated controls and dashboard fetches while letting mobile and desktop evolve
 * independently instead of stretching one layout across both form factors.
 */
export function DashboardView({
  greeting,
  groups,
}: {
  greeting: string;
  groups: DashboardGroup[];
}) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(query.matches);
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    // Older WebViews expose the legacy MediaQueryList listener API.
    query.addListener?.(update);
    return () => query.removeListener?.(update);
  }, []);

  return isDesktop ? (
    <DesktopDashboard greeting={greeting} groups={groups} />
  ) : (
    <MobileDashboard greeting={greeting} groups={groups} />
  );
}
