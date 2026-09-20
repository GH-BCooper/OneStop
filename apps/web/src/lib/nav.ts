export interface NavItem {
  label: string;
  href: string;
  icon?: string;
}

/**
 * Primary navigation, in master plan §18 order. "Home" is deliberately not listed here: the logo
 * and wordmark in the header already link to "/", and repeating it as its own nav item was pure
 * duplication. "Account" is not a nav link either — it is the profile control in the header's
 * action area (`AccountMenu`), which becomes a dropdown once signed in.
 */
export const primaryNav: NavItem[] = [
  { label: "AI Assistant", href: "/assistant", icon: "✨" },
  { label: "All Tools", href: "/tools", icon: "🧰" },
  { label: "Workflows", href: "/workflows", icon: "🔁" },
  { label: "History", href: "/history", icon: "🕘" },
];

/** Home matches only itself; every other item also matches its sub-routes. */
export function isNavItemActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
