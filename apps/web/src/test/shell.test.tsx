// @vitest-environment jsdom
import { THEME_STORAGE_KEY, themeCss, themeInitScript } from "@onestop/ui";
import { fireEvent, render, screen } from "@testing-library/react";
import { computeAccessibleName } from "dom-accessibility-api";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { Nav } from "@/components/layout/Nav";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
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

describe("route smoke test", () => {
  it.each(routeCases)("$path renders without throwing", async (route) => {
    await renderRoute(route);
    expect(screen.getByRole("heading", { level: 1, name: route.heading })).toBeTruthy();
  });
});

describe("primary nav", () => {
  it("lists the six sections in §18 order", () => {
    expect(primaryNav.map((i) => i.label)).toEqual([
      "Home",
      "AI Assistant",
      "All Tools",
      "Workflows",
      "History",
      "Account",
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

  it("shows all six §5 elements", async () => {
    await renderRoute(home);
    expect(screen.getByRole("searchbox", { name: /what do you want to do/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /ask onestop ai/i }).getAttribute("href")).toBe(
      "/assistant",
    );
    expect(screen.getByRole("heading", { name: /categories/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /popular tools/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /recent jobs/i })).toBeTruthy();
    // The badge reports verified connectivity now, so its first state is "Checking…" until a probe
    // answers (18-pwa-offline.md); phase 18's own suite covers each state.
    expect(screen.getAllByLabelText(/connection status:/i).length).toBeGreaterThan(0);
    const categoryLinks = screen
      .getAllByRole("link")
      .filter((l) => /^\/tools\/[^/]+$/.test(l.getAttribute("href") ?? ""));
    expect(categoryLinks).toHaveLength(8);
  });

  it("search submits to /tools with the query", async () => {
    await renderRoute(home);
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
    const { container } = await renderRoute(route);
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
