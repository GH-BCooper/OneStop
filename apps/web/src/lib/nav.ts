export interface NavItem {
  label: string;
  href: string;
  icon?: string;
}

/** Primary navigation, in master plan §18 order. */
export const primaryNav: NavItem[] = [
  { label: "Home", href: "/", icon: "🏠" },
  { label: "AI Assistant", href: "/assistant", icon: "✨" },
  { label: "All Tools", href: "/tools", icon: "🧰" },
  { label: "Workflows", href: "/workflows", icon: "🔁" },
  { label: "History", href: "/history", icon: "🕘" },
  { label: "Account", href: "/account", icon: "👤" },
];

/** Home matches only itself; every other item also matches its sub-routes. */
export function isNavItemActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
