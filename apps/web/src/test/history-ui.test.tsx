// @vitest-environment jsdom
//
// The phase-14 screens (14-history-favorites.md): the History page for a guest and for a
// signed-in user, the favourite star, the Home page's reflection of both, and the Settings page's
// sync. `next-auth/react` is mocked globally in `setup.tsx`; `session` there is what these tests
// flip to switch between a guest and an account.
import "fake-indexeddb/auto";
import { getTool } from "@onestop/tool-registry";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryView } from "@/components/history/HistoryView";
import { RecentTools } from "@/components/home/RecentTools";
import { SettingsView } from "@/components/settings/SettingsView";
import { FavoriteButton } from "@/components/tools/FavoriteButton";
import { readLocalFavorites } from "@/lib/favorites";
import { clearLocalHistory, recordLocalRun } from "@/lib/localHistory";
import { readThemePreference } from "@/lib/preferences";
import { session } from "./setup";

const MERGE = getTool("merge-pdf")!;

/**
 * Empties the store rather than deleting the database: `deleteDatabase` is blocked while any
 * connection is still open, and a component unmounted mid-read can leave one for a moment - which
 * made the reset silently do nothing under load.
 */
async function wipeDatabase(): Promise<void> {
  await clearLocalHistory();
}

/** The star is disabled until the first favourites read finishes; clicking before that does nothing. */
async function enabledStar(name: RegExp): Promise<HTMLElement> {
  const star = await screen.findByRole("button", { name });
  await waitFor(() => expect((star as HTMLButtonElement).disabled).toBe(false));
  return star;
}

const fetchMock = vi.fn();

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

beforeEach(async () => {
  await wipeDatabase();
  localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function signIn() {
  session.data = { user: { id: "user-1", email: "sam@example.com", name: "Sam" } };
  session.status = "authenticated";
}

describe("/history as a guest", () => {
  it("shows this device's runs and offers to sign in, with no history request at all", async () => {
    await recordLocalRun({
      toolId: "merge-pdf",
      status: "success",
      summary: "Merged 2 files",
      inputs: ["a.pdf", "b.pdf"],
    });

    render(<HistoryView initial={{ category: "", page: 1 }} accountsEnabled />);

    expect(await screen.findByText("Merged 2 files")).toBeTruthy();
    expect(screen.getByText(/1 run/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /sign in to save your history/i })).toBeTruthy();
    // The guest path is offline-safe by construction: nothing went to the network.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says the history is device-only, and empties when the browser's storage goes", async () => {
    render(<HistoryView initial={{ category: "", page: 1 }} accountsEnabled />);
    expect(await screen.findByText(/this device only/i)).toBeTruthy();
    expect(await screen.findByText(/nothing here yet/i)).toBeTruthy();
  });

  it("filters by status without a request", async () => {
    await recordLocalRun({ toolId: "merge-pdf", status: "success", summary: "Ok" });
    await recordLocalRun({ toolId: "split-pdf", status: "failed", error: "Nope" });

    render(<HistoryView initial={{ category: "", page: 1 }} accountsEnabled />);
    expect(await screen.findByText(/2 runs/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "failed" } });
    await waitFor(() => expect(screen.getByText(/1 run match/)).toBeTruthy());
    expect(screen.getByText("Nope")).toBeTruthy();
    expect(screen.queryByText("Ok")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("/history when signed in", () => {
  it("reads the account's history and offers to import what is on the device", async () => {
    signIn();
    await recordLocalRun({ toolId: "split-pdf", status: "success" });
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        jsonResponse({
          ok: true,
          entries: [
            {
              id: "job-1",
              toolId: "merge-pdf",
              status: "success",
              createdAt: "2026-09-19T10:00:00.000Z",
              summary: "Merged on the server",
              inputs: ["a.pdf"],
              outputs: [],
              error: null,
              scope: "account",
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
          pageCount: 1,
        }),
      ).then((r) => {
        expect(String(url)).toContain("/api/history");
        return r;
      }),
    );

    render(<HistoryView initial={{ category: "", page: 1 }} accountsEnabled />);

    expect(await screen.findByText("Merged on the server")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /sign in to save/i })).toBeNull();
    expect(await screen.findByRole("button", { name: /import into my account/i })).toBeTruthy();
  });

  it("groups a workflow's steps under one heading instead of listing them as unrelated runs", async () => {
    signIn();
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        entries: [
          {
            id: "job-2",
            toolId: "image-to-pdf",
            status: "success",
            createdAt: "2026-09-22T10:01:00.000Z",
            summary: "Made a PDF",
            inputs: ["b.png"],
            outputs: [],
            error: null,
            scope: "account",
            workflow: { runId: "run-1", name: "Scan pipeline", stepIndex: 1, stepCount: 2 },
          },
          {
            id: "job-1",
            toolId: "compress-image",
            status: "success",
            createdAt: "2026-09-22T10:00:00.000Z",
            summary: "Compressed 1 file",
            inputs: ["a.png"],
            outputs: [],
            error: null,
            scope: "account",
            workflow: { runId: "run-1", name: "Scan pipeline", stepIndex: 0, stepCount: 2 },
          },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
        pageCount: 1,
      }),
    );

    render(<HistoryView initial={{ category: "", page: 1 }} accountsEnabled />);

    expect(await screen.findByText("Scan pipeline")).toBeTruthy();
    expect(screen.getByText("2 steps")).toBeTruthy();
    expect(screen.getByText("Compressed 1 file")).toBeTruthy();
    expect(screen.getByText("Made a PDF")).toBeTruthy();
    // Steps render in run order (0, then 1) even though the API returned them newest-first.
    const summaries = screen.getAllByText(/Compressed 1 file|Made a PDF/).map((n) => n.textContent);
    expect(summaries).toEqual(["Compressed 1 file", "Made a PDF"]);
  });
});

describe("favourites", () => {
  it("toggles on and off for a guest and persists on the device", async () => {
    render(<FavoriteButton toolId={MERGE.id} toolName={MERGE.name} />);
    const star = await enabledStar(/add merge pdf to favourites/i);
    expect(star.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(star);
    await waitFor(() => expect(readLocalFavorites()).toEqual([MERGE.id]));
    expect(
      screen
        .getByRole("button", { name: /remove merge pdf from favourites/i })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /remove merge pdf from favourites/i }));
    await waitFor(() => expect(readLocalFavorites()).toEqual([]));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("writes to the account when signed in", async () => {
    signIn();
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, favorites: [MERGE.id], on: true }));

    render(<FavoriteButton toolId={MERGE.id} toolName={MERGE.name} />);
    fireEvent.click(await enabledStar(/add merge pdf to favourites/i));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/favorites",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    // Nothing was written to the device: the account is the store now.
    expect(readLocalFavorites()).toEqual([]);
  });

  it("appears on the Home page once starred", async () => {
    localStorage.setItem("onestop-favorites", JSON.stringify([MERGE.id]));
    await recordLocalRun({ toolId: "split-pdf", status: "success" });

    render(<RecentTools />);

    expect(await screen.findByRole("heading", { name: /your favourites/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: MERGE.name })).toBeTruthy();
    expect(screen.getByText(/saved on this device/i)).toBeTruthy();
    // ...and the tool that was actually run shows under "Recently used".
    expect(await screen.findByRole("heading", { name: /recently used/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: getTool("split-pdf")!.name })).toBeTruthy();
  });

  it("renders nothing when there is neither a favourite nor a run", async () => {
    const { container } = render(<RecentTools />);
    await waitFor(() => expect(container.querySelector("section")).toBeNull());
  });
});

describe("/settings", () => {
  it("applies a theme on this device and prompts a guest to sign in", async () => {
    render(<SettingsView accountsEnabled />);

    expect(
      await screen.findByRole("link", { name: /sign in to sync your settings/i }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(readThemePreference()).toBe("dark");
    expect(screen.getByText(/saved on this device/i)).toBeTruthy();
    // A guest's settings are never sent anywhere; the only call is the AI service's own
    // availability check, which carries nothing from the visitor.
    expect(
      fetchMock.mock.calls.every(([url]) => String(url).includes("/api/assistant/status")),
    ).toBe(true);
  });

  it("saves to the account when signed in, and picks the account's settings up first", async () => {
    signIn();
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(
        jsonResponse({
          ok: true,
          settings: {
            userId: "user-1",
            theme: init?.method === "PATCH" ? "light" : "dark",
            preferredAI: "ollama",
            preferences: {},
            updatedAt: "2026-09-19T10:00:00.000Z",
          },
        }),
      ),
    );

    render(<SettingsView accountsEnabled />);

    // Session B effect: the account's stored theme is applied to this browser on load.
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(screen.queryByRole("link", { name: /sign in to sync/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/settings",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    expect(await screen.findByText(/saved to your account/i)).toBeTruthy();
  });
});
