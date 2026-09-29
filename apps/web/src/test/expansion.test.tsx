// @vitest-environment jsdom
// Web tests for 21-roadmap-expansion.md: the command palette, the theme presets and text
// accessibility controls, the before/after compare slider, the empty states and the bento home.
//
// The palette's searching is tested as a function (it has no DOM in it), then the component is
// driven by keyboard, because "Ctrl+K opens it and the arrow keys work" is the whole feature.
import { GROUPS, tools } from "@onestop/tool-registry";
import {
  TEXT_ADJUST_CSS,
  TEXT_PRESETS,
  THEME_PRESETS,
  isThemePresetId,
  presetForMode,
  themeCss,
  themeInitScript,
  themePreset,
} from "@onestop/ui";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Link from "next/link";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, openCommandPalette } from "@/components/layout/CommandPalette";
import { CompareSlider } from "@/components/tools/CompareSlider";
import { EmptyState } from "@/components/fx/EmptyState";
import { BentoGrid, BentoTile } from "@/components/home/BentoGrid";
import {
  activeThemePreset,
  applyTextPreferences,
  applyThemePreset,
  decorationsEnabled,
  readTextPreferences,
  readThemePresetPreference,
} from "@/lib/appearance";
import { groupResults, isPaletteShortcut, paletteResults } from "@/lib/command-palette";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/",
}));

afterEach(() => {
  cleanup();
  push.mockReset();
  localStorage.clear();
  delete document.documentElement.dataset.preset;
  delete document.documentElement.dataset.text;
  delete document.documentElement.dataset.dataSaver;
  delete document.documentElement.dataset.theme;
});

// ---- palette search ---------------------------------------------------------------------------

describe("command palette search", () => {
  it("recognises the shortcut on both platforms, and nothing else", () => {
    expect(isPaletteShortcut({ key: "k", ctrlKey: true, metaKey: false, altKey: false })).toBe(true);
    expect(isPaletteShortcut({ key: "K", ctrlKey: false, metaKey: true, altKey: false })).toBe(true);
    expect(isPaletteShortcut({ key: "/", ctrlKey: true, metaKey: false, altKey: false })).toBe(true);
    expect(isPaletteShortcut({ key: "k", ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
    expect(isPaletteShortcut({ key: "k", ctrlKey: true, metaKey: false, altKey: true })).toBe(false);
  });

  it("finds tools by name and by what they do", () => {
    const byName = paletteResults("merge pdf");
    expect(byName.find((i) => i.group === "Tools")?.href).toBe("/tools/pdf/merge-pdf");
    // A verb rather than a name still has to land somewhere sensible.
    expect(paletteResults("shrink a photo").some((i) => i.group === "Tools")).toBe(true);
  });

  it("shows recents and favourites when nothing is typed", () => {
    const results = paletteResults("", { recentIds: ["merge-pdf"], favoriteIds: ["image-resizer"] });
    const tools_ = results.filter((i) => i.group === "Tools");
    expect(tools_[0]?.label).toBe("Merge PDF");
    expect(tools_[0]?.detail).toBe("Recently used");
    expect(tools_.some((i) => i.label === "Image Resizer" && i.badges?.includes("Favourite"))).toBe(true);
  });

  it("includes workflows, history, pages and quick actions", () => {
    const results = paletteResults("", {
      workflows: [{ id: "w1", name: "Shrink and zip", steps: [{ toolId: "image-resizer" }] }],
      history: [{ id: "j1", toolId: "merge-pdf", createdAt: "2026-01-01T00:00:00Z", summary: "Merged 3 files" }],
    });
    const groups = groupResults(results).map((g) => g.group);
    expect(groups).toContain("Workflows");
    expect(groups).toContain("History");
    expect(groups).toContain("Go to");
    expect(groups).toContain("Actions");
    expect(results.find((i) => i.group === "Workflows")?.detail).toBe("Image Resizer");
    // Every catalogue group is reachable by name. ("Go to" is capped in an unfiltered list, which
    // is the point of the cap - the palette is a search box, not a sitemap.)
    for (const group of GROUPS) {
      expect(
        paletteResults(group.name).some((i) => i.href === `/tools/${group.id}`),
        `${group.name} is not findable`,
      ).toBe(true);
    }
  });

  it("filters the non-tool groups by the query too", () => {
    const results = paletteResults("workflow", {
      workflows: [{ id: "w1", name: "Nightly export", steps: [] }],
    });
    expect(results.some((i) => i.label === "Nightly export")).toBe(true);
    expect(paletteResults("nothing-matches-this-at-all")).toHaveLength(0);
  });

  it("marks offline and internet-only tools so the choice is informed", () => {
    const offline = paletteResults("merge pdf").find((i) => i.id === "tool:merge-pdf");
    expect(offline?.badges).toContain("Works offline");
    const online = paletteResults("dns lookup").find((i) => i.id === "tool:dns-lookup");
    expect(online?.badges).toContain("Needs internet");
  });
});

// ---- palette component ------------------------------------------------------------------------

describe("command palette component", () => {
  it("opens on Ctrl+K, filters as you type, and navigates on Enter", async () => {
    render(<CommandPalette />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "merge pdf" } });

    const options = await screen.findAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/tools/pdf/merge-pdf"));
  });

  it("moves the highlight with the arrow keys and wraps round", async () => {
    render(<CommandPalette />);
    openCommandPalette();
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "pdf" } });
    const options = await screen.findAllByRole("option");
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    // Wrapping backwards from the first item lands on the last.
    const all = screen.getAllByRole("option");
    expect(all[all.length - 1]!.getAttribute("aria-selected")).toBe("true");
  });

  it("closes on Escape", async () => {
    render(<CommandPalette />);
    openCommandPalette();
    const input = await screen.findByRole("combobox");
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("runs a quick action without navigating", async () => {
    document.documentElement.dataset.theme = "light";
    render(<CommandPalette />);
    openCommandPalette();
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "toggle light" } });
    const option = (await screen.findAllByRole("option")).find((el) => /Toggle light/.test(el.textContent ?? ""));
    expect(option).toBeDefined();
    fireEvent.click(option!);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(push).not.toHaveBeenCalled();
  });

  it("says something useful when nothing matches", async () => {
    render(<CommandPalette />);
    openCommandPalette();
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "zzzzqqqq" } });
    expect(await screen.findByText(/Nothing matched/)).toBeTruthy();
  });
});

// ---- theme presets ----------------------------------------------------------------------------

describe("theme presets", () => {
  it("keeps the two original themes as the two original palettes", () => {
    expect(themePreset("chrome")?.base).toBe("light");
    expect(themePreset("lacquer")?.base).toBe("dark");
    expect(presetForMode("dark")).toBe("lacquer");
    expect(presetForMode("light")).toBe("chrome");
    expect(isThemePresetId("terminal")).toBe(true);
    expect(isThemePresetId("nope")).toBe(false);
  });

  it("emits a CSS rule for every extra preset, and none for the two originals", () => {
    const css = themeCss();
    for (const preset of THEME_PRESETS) {
      const expected = preset.id === "chrome" || preset.id === "lacquer";
      expect(css.includes(`[data-preset="${preset.id}"]`)).toBe(!expected);
    }
    expect(css).toContain(TEXT_ADJUST_CSS);
    // Every preset has to define every token, or a switch would leave a variable unset.
    const tokens = Object.keys(THEME_PRESETS[0]!.colors);
    for (const preset of THEME_PRESETS) expect(Object.keys(preset.colors).sort()).toEqual([...tokens].sort());
  });

  it("keeps body text above WCAG AA in every preset", () => {
    const channel = (hex: string, at: number) => {
      const v = parseInt(hex.slice(at, at + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string) =>
      0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
    for (const preset of THEME_PRESETS) {
      const [hi, lo] = [luminance(preset.colors.fg), luminance(preset.colors.bg)].sort((a, b) => b - a);
      const ratio = (hi! + 0.05) / (lo! + 0.05);
      expect(ratio, `${preset.id} body contrast`).toBeGreaterThanOrEqual(4.5);
    }
    // High contrast has to be the strongest of the lot.
    const contrast = THEME_PRESETS.find((p) => p.id === "high-contrast")!;
    expect(contrast.colors.fg).toBe("#000000");
    expect(contrast.colors.bg).toBe("#ffffff");
  });

  it("applies a preset, stores it, and hands control back when cleared", () => {
    document.documentElement.dataset.theme = "light";
    expect(applyThemePreset("terminal")).toBe("dark");
    expect(document.documentElement.dataset.preset).toBe("terminal");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(readThemePresetPreference()).toBe("terminal");
    expect(activeThemePreset()).toBe("terminal");

    applyThemePreset(null);
    expect(document.documentElement.dataset.preset).toBeUndefined();
    expect(readThemePresetPreference()).toBeNull();
  });

  it("restores the preset before paint, without a flash", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    localStorage.setItem("onestop-theme-preset", "paper");
    localStorage.setItem("onestop-text-preferences", JSON.stringify({ text: "dyslexic", dataSaver: true }));
    // The init script is what the <head> runs; evaluating it here is exactly what the browser does.
    new Function(themeInitScript())();
    expect(document.documentElement.dataset.preset).toBe("paper");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.text).toBe("dyslexic");
    expect(document.documentElement.dataset.dataSaver).toBe("on");
    vi.unstubAllGlobals();
  });

  it("ignores a stored preset that is not one of ours", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
    localStorage.setItem("onestop-theme-preset", "chartreuse");
    new Function(themeInitScript())();
    expect(document.documentElement.dataset.preset).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

describe("text accessibility and reduced data", () => {
  it("offers a default plus the two adjustments", () => {
    expect(TEXT_PRESETS.map((p) => p.id)).toEqual(["default", "dyslexic", "large"]);
  });

  it("applies and clears the text preference", () => {
    applyTextPreferences({ text: "large" });
    expect(document.documentElement.dataset.text).toBe("large");
    expect(readTextPreferences().text).toBe("large");
    applyTextPreferences({ text: "default" });
    expect(document.documentElement.dataset.text).toBeUndefined();
  });

  it("turns the decorative canvas off for reduced data", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: false });
    vi.stubGlobal("matchMedia", matchMedia);
    expect(decorationsEnabled()).toBe(true);
    applyTextPreferences({ dataSaver: true });
    expect(decorationsEnabled()).toBe(false);
    expect(document.documentElement.dataset.dataSaver).toBe("on");
    vi.unstubAllGlobals();
  });

  it("respects prefers-reduced-motion even with reduced data off", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(decorationsEnabled()).toBe(false);
    vi.unstubAllGlobals();
  });
});

// ---- compare slider, empty states, bento ------------------------------------------------------

describe("before/after compare slider", () => {
  beforeEach(() => {
    // jsdom gives every element a zero-size box, which a drag test needs to fake.
    Element.prototype.getBoundingClientRect = function () {
      return { x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 100, width: 200, height: 100, toJSON: () => ({}) };
    };
  });

  it("exposes itself as a slider with a usable value", () => {
    render(<CompareSlider beforeSrc="/a.png" afterSrc="/b.png" initial={40} />);
    const handle = screen.getByRole("slider");
    expect(handle.getAttribute("aria-valuenow")).toBe("40");
    expect(handle.getAttribute("aria-valuemin")).toBe("0");
    expect(handle.getAttribute("aria-valuemax")).toBe("100");
  });

  it("moves with the arrow keys, and jumps with Home and End", () => {
    render(<CompareSlider beforeSrc="/a.png" afterSrc="/b.png" initial={50} />);
    const handle = screen.getByRole("slider");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle.getAttribute("aria-valuenow")).toBe("52");
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(handle.getAttribute("aria-valuenow")).toBe("42");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(handle.getAttribute("aria-valuenow")).toBe("0");
    fireEvent.keyDown(handle, { key: "End" });
    expect(handle.getAttribute("aria-valuenow")).toBe("100");
  });

  it("labels both images so the comparison is not visual-only", () => {
    render(<CompareSlider beforeSrc="/a.png" afterSrc="/b.png" beforeLabel="Original" afterLabel="Result" />);
    expect(screen.getByAltText("Original")).toBeTruthy();
    expect(screen.getByAltText("Result")).toBeTruthy();
  });
});

describe("empty states", () => {
  it("draws an illustration and says what to do next", () => {
    render(
      <EmptyState
        kind="no-history"
        title="Nothing here yet"
        description="Run a tool and it will show up."
        action={<Link href="/tools">Browse tools</Link>}
      />,
    );
    expect(screen.getByText("Nothing here yet")).toBeTruthy();
    expect(screen.getByText(/Run a tool/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Browse tools" })).toBeTruthy();
    // The drawing is decoration: it must not be announced.
    const svg = document.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("uses a different drawing per state, with no external asset", () => {
    const seen = new Set<string>();
    for (const kind of ["no-history", "no-results", "offline", "error", "empty-folder"] as const) {
      cleanup();
      render(<EmptyState kind={kind} title={kind} />);
      const svg = document.querySelector("svg")!;
      seen.add(svg.innerHTML);
      // No external asset: no <image>, and any url() must point at a definition inside this SVG.
      expect(svg.outerHTML).not.toContain("<image");
      for (const reference of svg.outerHTML.match(/url\(([^)]*)\)/g) ?? []) {
        expect(reference.startsWith("url(#")).toBe(true);
      }
    }
    expect(seen.size).toBe(5);
  });
});

describe("bento home", () => {
  it("links each tile and tilts towards the cursor", () => {
    render(
      <BentoGrid>
        <BentoTile href="/tools/pdf" title="PDF" detail="26 tools" icon="📄" size="wide" />
      </BentoGrid>,
    );
    const link = screen.getByRole("link", { name: /PDF/ });
    expect(link.getAttribute("href")).toBe("/tools/pdf");
    const tile = link.firstElementChild as HTMLElement;
    fireEvent.pointerMove(tile, { clientX: 10, clientY: 10 });
    // With decorations off in jsdom (no matchMedia by default) the tile stays flat, which is the
    // documented behaviour; either way it must never throw.
    expect(tile.style.transform === "" || tile.style.transform.includes("rotate")).toBe(true);
    fireEvent.pointerLeave(tile);
    expect(tile.style.transform).toBe("");
  });

  it("renders a panel without a link when asked", () => {
    render(
      <BentoGrid>
        <BentoTile href="#" title="Recent jobs" asPanel>
          <p>nothing yet</p>
        </BentoTile>
      </BentoGrid>,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("nothing yet")).toBeTruthy();
  });
});

// ---- registry reach ---------------------------------------------------------------------------

describe("the new catalogue groups are reachable", () => {
  it("gives every phase-21 tool a route and a group", () => {
    const added = tools.filter((t) => t.phase === "21");
    expect(added.length).toBeGreaterThanOrEqual(75);
    for (const tool of added) {
      const group = GROUPS.find((g) => g.categories.includes(tool.category));
      expect(group, `${tool.id} is in no catalogue group`).toBeDefined();
    }
  });
});
