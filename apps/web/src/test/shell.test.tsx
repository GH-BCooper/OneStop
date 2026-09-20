// @vitest-environment jsdom
import { THEME_STORAGE_KEY, themeCss, themeInitScript } from "@onestop/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { computeAccessibleName } from "dom-accessibility-api";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { Dashboard } from "@/components/home/Dashboard";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { Nav } from "@/components/layout/Nav";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { authIsConfigured } from "@/lib/auth-config";
import { isNavItemActive, primaryNav } from "@/lib/nav";
import { routeCases } from "./routes";
import { navigation } from "./setup";

async function renderRoute(route: (typeof routeCases)[number]) {
  const mod = await route.load();
  const Page = mod.default as (props: { params: Promise<Record<string, string>> }) => unknown;
  // Server components may be async; resolve them to an element before rendering.
  const element = (await Page({ params: Promise.resolve(route.params ?? {}) })) as ReactElement;
  navigation.pathname = route.path;
  return render(
    <>
      <Header />
      {element}
      <Footer />
    </>,
  );
}

/**
 * Renders a route, tolerating the one thing a signed-out render may legitimately do instead:
 * redirect. `/account` renders a "sign in to keep your history" card when no database is
 * configured, and redirects to the login page when one is - both correct, and which of the two
 * happens depends on the developer's `.env`, not on the code under test. Returning the redirect
 * target instead of throwing lets the same assertion cover both (19-testing.md).
 */
async function renderOrRedirect(
  route: (typeof routeCases)[number],
): Promise<{ rendered: ReturnType<typeof render> | null; redirectedTo: string | null }> {
  try {
    return { rendered: await renderRoute(route), redirectedTo: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = /^NEXT_REDIRECT:(.*)$/.exec(message);
    if (!match) throw error;
    // The redirect happened mid-render, so nothing of this route is mounted; clean up whatever
    // the shell put in the document so the next case starts from an empty body.
    cleanup();
    return { rendered: null, redirectedTo: match[1]! };
  }
}

describe("route smoke test", () => {
  it.each(routeCases)("$path renders without throwing", async (route) => {
    const { redirectedTo } = await renderOrRedirect(route);
    if (redirectedTo) {
      // An auth-gated route may send a signed-out visitor to the login page instead of rendering.
      expect(redirectedTo).toMatch(/^\/auth\/login/);
      return;
    }
    expect(screen.getByRole("heading", { level: 1, name: route.heading })).toBeTruthy();
  });
});

describe("primary nav", () => {
  it("lists the four sections in §18 order (Home and Account are not nav links)", () => {
    // The logo/wordmark link to "/" already, and "Account" became the header's dropdown
    // (`AccountMenu`) rather than a plain nav link - see CLAUDE.md item 12 of the redesign.
    expect(primaryNav.map((i) => i.label)).toEqual([
      "AI Assistant",
      "All Tools",
      "Workflows",
      "History",
    ]);
  });

  it.each([
    ["/", "/", true],
    ["/", "/tools", false],
    ["/tools", "/tools", true],
    ["/tools", "/tools/pdf/merge-pdf", true],
    ["/tools", "/toolsmith", false],
    ["/workflows", "/workflows/new", true],
    ["/account", null, false],
  ] as const)("isNavItemActive(%s, %s) is %s", (href, pathname, expected) => {
    expect(isNavItemActive(href, pathname)).toBe(expected);
  });

  it("marks only the active route with aria-current", () => {
    navigation.pathname = "/workflows/new";
    render(<Nav />);
    const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current"));
    expect(current.map((l) => l.textContent)).toEqual(["🔁Workflows"]);
  });

  it.each(["light", "dark"] as const)("matches snapshot in %s theme", (theme) => {
    document.documentElement.dataset.theme = theme;
    navigation.pathname = "/tools";
    const { container } = render(<Nav />);
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(container.innerHTML).toMatchSnapshot();
  });
});

describe("theme", () => {
  it("toggles instantly and persists to localStorage", () => {
    document.documentElement.dataset.theme = "light";
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /switch to dark theme/i }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: /switch to light theme/i }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("restores the stored theme on load (init script)", () => {
    window.matchMedia = () => ({ matches: false }) as MediaQueryList;
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    new Function(themeInitScript())();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("ignores invalid stored values and uses the OS preference", () => {
    window.matchMedia = () => ({ matches: true }) as MediaQueryList;
    localStorage.setItem(THEME_STORAGE_KEY, "purple");
    new Function(themeInitScript())();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("emits CSS variables for both themes", () => {
    const css = themeCss();
    expect(css).toContain(":root{");
    expect(css).toContain(':root[data-theme="dark"]{');
    expect(css).toMatch(/--os-primary:#[0-9a-f]{6};/);
  });
});

describe("home page", () => {
  const home = routeCases[0]!;

  // "/" renders the marketing Landing page for a guest, or the personalized Dashboard for anyone
  // else (a signed-in visitor, or every visitor on an instance with no accounts at all). Which of
  // the two a *guest* sees therefore depends on whether this machine's own .env configures
  // accounts - exactly the same environment dependency `/account`'s tests above already document
  // and tolerate - so the content checks below run only when that is true, the way it is on every
  // machine this suite is normally run on.
  it.skipIf(!authIsConfigured())(
    "guest sees the marketing Landing page, with Get Started and the category cards",
    async () => {
      await renderRoute(home);
      expect(screen.getByRole("heading", { level: 1, name: /one stop/i })).toBeTruthy();
      expect(screen.getAllByRole("link", { name: /get started/i }).length).toBeGreaterThan(0);
      const categoryLinks = screen
        .getAllByRole("link")
        .filter((l) => /^\/tools\/[^/]+$/.test(l.getAttribute("href") ?? ""));
      expect(categoryLinks).toHaveLength(8);
    },
  );

  // The Dashboard itself (as opposed to which of it-or-Landing "/" picks) does not depend on a
  // real session: it is a plain component that takes the visitor's name as a prop. `page.tsx`
  // resolves that name from a real, cookie-based `auth()` call, which this jsdom render has no
  // request to back - so the Dashboard's own content is tested directly here instead of through
  // the route loader, the same way `home` above only exercises the reachable, session-free path.
  it("Dashboard shows all six §5 elements, greeting the visitor by name", () => {
    render(<Dashboard name="Brett Cooper" />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toMatch(/good (morning|afternoon|evening), Brett/i);
    expect(screen.getByRole("searchbox", { name: /what do you want to do/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /all tools/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /popular tools/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /recent jobs/i })).toBeTruthy();
    const categoryLinks = screen
      .getAllByRole("link")
      .filter((l) => /^\/tools\/[^/]+$/.test(l.getAttribute("href") ?? ""));
    expect(categoryLinks).toHaveLength(8);
  });

  it("Dashboard falls back to a plain greeting with no name", () => {
    render(<Dashboard name={null} />);
    expect(
      screen.getByRole("heading", { level: 1, name: /^good (morning|afternoon|evening)$/i }),
    ).toBeTruthy();
  });

  it("search submits to /tools with the query", () => {
    render(<Dashboard name="Brett Cooper" />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "merge pdf" } });
    fireEvent.submit(screen.getByRole("search"));
    expect(navigation.push).toHaveBeenCalledWith("/tools?q=merge%20pdf");
  });
});

describe("header", () => {
  it("opens and closes the mobile menu", () => {
    render(<Header />);
    const toggle = screen.getByRole("button", { name: /open menu/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("navigation", { name: /mobile/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /close menu/i }));
    expect(screen.queryByRole("navigation", { name: /mobile/i })).toBeNull();
  });
});

describe("accessibility basics", () => {
  it.each(routeCases)("$path: every interactive element has a name", async (route) => {
    const { rendered } = await renderOrRedirect(route);
    // A route that redirected rendered nothing to check; the smoke test above covers that case.
    if (!rendered) return;
    const { container } = rendered;
    fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
    const interactive = container.querySelectorAll<HTMLElement>(
      "a, button, input, select, textarea, [role=tab]",
    );
    expect(interactive.length).toBeGreaterThan(0);
    for (const el of interactive) {
      expect(computeAccessibleName(el), el.outerHTML).not.toBe("");
    }
    for (const img of container.querySelectorAll("img")) {
      expect(img.hasAttribute("alt"), img.outerHTML).toBe(true);
    }
  });
});
