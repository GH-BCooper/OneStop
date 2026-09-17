"use client";

import { cn } from "@onestop/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavItemActive, primaryNav, type NavItem } from "@/lib/nav";

export interface NavProps {
  items?: NavItem[];
  orientation?: "horizontal" | "vertical";
  label?: string;
  onNavigate?: () => void;
}

export function Nav({
  items = primaryNav,
  orientation = "horizontal",
  label = "Primary",
  onNavigate,
}: NavProps) {
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      <ul className={cn("flex gap-1", orientation === "vertical" && "flex-col")}>
        {items.map((item) => {
          const active = isNavItemActive(item.href, pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-ring",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-fg-muted hover:bg-surface-muted hover:text-fg",
                )}
              >
                {item.icon && <span aria-hidden="true">{item.icon}</span>}
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
