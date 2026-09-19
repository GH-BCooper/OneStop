// @vitest-environment jsdom
import {
  CATEGORIES,
  GROUPS,
  getTool,
  toolHref,
  tools,
  type ToolMeta,
} from "@onestop/tool-registry";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolPage, validateToolInput } from "@/components/tools/ToolPage";
import {
  initialToolState,
  toolReducer,
  ToolStateView,
  TOOL_STATES,
  type ToolState,
} from "@/components/tools/ToolStateMachine";
import { parseExplorerParams } from "@/lib/tool-search-params";
import CategoryPage, { generateStaticParams as categoryParams } from "@/app/tools/[category]/page";
import ToolRoute, { generateStaticParams as toolParams } from "@/app/tools/[category]/[slug]/page";

const byId = (id: string) => getTool(id)!;

/**
 * Phase 04 moved execution behind POST /api/tools/run, so the tool page's happy/unhappy paths are
 * driven by a stubbed response here. The route itself is tested in `file-core-api.test.ts`.
 */
function mockRun(body: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

type ServerPage<P> = (props: { params: Promise<P> }) => Promise<ReactElement>;

async function renderServer<P extends Record<string, string>>(Page: ServerPage<P>, params: P) {
  return render(await Page({ params: Promise.resolve(params) }));
}

describe("registry ↔ route contract", () => {
  it("generates a route for every tool", () => {
    const routes = new Set(toolParams().map((p) => `/tools/${p.category}/${p.slug}`));
    expect(routes.size).toBe(tools.length);
    for (const t of tools) expect(routes.has(toolHref(t))).toBe(true);
  });

  it("generates a page for every category and group", () => {
    const params = categoryParams().map((p) => p.category);
    for (const c of CATEGORIES) expect(params).toContain(c.id);
    for (const g of GROUPS) expect(params).toContain(g.id);
  });

  it("renders every tool page without throwing", async () => {
    for (const t of tools) {
      const element = await ToolRoute({
        params: Promise.resolve({ category: t.category, slug: t.slug }),
      });
      expect(element).toBeTruthy();
    }
  });

  it("404s on an unknown tool or category", async () => {
    await expect(
      ToolRoute({ params: Promise.resolve({ category: "pdf", slug: "nope" }) }),
    ).rejects.toThrow();
    await expect(CategoryPage({ params: Promise.resolve({ category: "nope" }) })).rejects.toThrow();
  });

  it("lists every tool of a category on its category page", async () => {
    for (const id of ["pdf", "qr", "network"]) {
      const { unmount } = await renderServer(CategoryPage, { category: id });
      const listed = screen.getAllByRole("link").map((a) => a.getAttribute("data-tool-id"));
      for (const t of tools.filter((x: ToolMeta) => x.category === id)) {
        expect(listed).toContain(t.id);
      }
      unmount();
    }
  });

  it("shows a group page with all its categories", async () => {
    await renderServer(CategoryPage, { category: "media" });
    expect(screen.getByRole("heading", { level: 1, name: /audio & video tools/i })).toBeTruthy();
    for (const sub of ["Audio", "Video", "Online Media"]) {
      expect(screen.getByRole("heading", { level: 2, name: sub })).toBeTruthy();
    }
  });
});

describe("tool page", () => {
  it("shows input, output and capability badges from the registry", async () => {
    await renderServer(ToolRoute, { category: "pdf", slug: "merge-pdf" });
    expect(screen.getByRole("heading", { level: 1, name: "Merge PDF" })).toBeTruthy();
    // Phase 05 verified Merge PDF offline, so the badge is now the stronger claim.
    expect(screen.getByText(/works offline/i)).toBeTruthy();
    expect(screen.getByText(/^available$/i)).toBeTruthy();
    expect(screen.getByText(/batch/i)).toBeTruthy();
  });

  it("warns that internet-only tools need a connection", async () => {
    await renderServer(ToolRoute, { category: "online-media", slug: "youtube-to-mp3" });
    expect(screen.getByText(/needs internet/i)).toBeTruthy();
  });

  it("lets file-or-text tools take pasted text and sends it as `text` (07)", async () => {
    const fetchMock = mockRun({ ok: true, job: { id: "j", status: "success" }, summary: "Done." });
    render(<ToolPage tool={byId("grammar-checker")} />);
    fireEvent.change(screen.getByLabelText(/or paste text instead/i), {
      target: { value: "i could of gone" },
    });
    fireEvent.click(screen.getByRole("button", { name: /run grammar checker/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(body.get("text")).toBe("i could of gone");
    expect(body.getAll("files")).toHaveLength(0);
    // A file-only tool has no text box.
    render(<ToolPage tool={byId("word-to-pdf")} />);
    expect(screen.getAllByLabelText(/or paste text instead/i)).toHaveLength(1);
  });

  it("says 'Coming in a later phase' for every unimplemented tool", async () => {
    for (const t of tools.filter((x) => x.status === "stub").slice(0, 5)) {
      const { unmount } = await renderServer(ToolRoute, { category: t.category, slug: t.slug });
      expect(screen.getByTestId("coming-soon").textContent).toMatch(/coming in a later phase/i);
      unmount();
    }
  });

  it("reports a not-implemented tool as unavailable instead of faking success", async () => {
    mockRun({
      ok: false,
      error: {
        code: "NOT_IMPLEMENTED",
        message: "AI PDF Summarizer is coming in a later phase (16-ai-assistant.md).",
      },
    });
    render(
      <ToolPage
        tool={byId("ai-pdf-summarizer")}
        initialState={{
          status: "selected",
          input: { kind: "files", files: [{ name: "a.pdf", size: 10, type: "application/pdf" }] },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /run ai pdf summarizer/i }));
    await waitFor(() => {
      const panel = screen.getByRole("status");
      expect(panel.textContent).toMatch(/coming in a later phase/i);
    });
    expect(screen.queryByRole("button", { name: /^download$/i })).toBeNull();
  });

  it("runs the demo tool through the pipeline and offers the result for download", async () => {
    const fetchMock = mockRun({
      ok: true,
      job: { id: "job-1", status: "success" },
      output: { files: [{ name: "a.txt", size: 12 }] },
      summary: "a.txt - 12 B",
      files: [
        {
          id: "11111111-2222-3333-4444-555555555555",
          name: "a.txt.metadata.json",
          mimeType: "application/json",
          size: 120,
          url: "/api/files/11111111-2222-3333-4444-555555555555",
          expiresAt: new Date().toISOString(),
        },
      ],
    });
    render(
      <ToolPage
        tool={byId("file-metadata-viewer")}
        initialState={{
          status: "selected",
          input: { kind: "files", files: [{ name: "a.txt", size: 12, type: "text/plain" }] },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /run file metadata viewer/i }));
    const link = await screen.findByTestId("result-download");
    expect(link.getAttribute("href")).toBe("/api/files/11111111-2222-3333-4444-555555555555");
    expect(link.getAttribute("download")).toBe("a.txt.metadata.json");
    expect(screen.getByRole("status").textContent).toMatch(/done/i);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tools/run",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows the server's rejection when it is the one that catches a bad file", async () => {
    mockRun({
      ok: false,
      error: { code: "UNSUPPORTED_INPUT", message: "This file type is not supported." },
    });
    render(
      <ToolPage
        tool={byId("file-metadata-viewer")}
        initialState={{
          status: "selected",
          input: { kind: "files", files: [{ name: "a.txt", size: 12, type: "text/plain" }] },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /run file metadata viewer/i }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/file type is not supported/i),
    );
  });

  it("rejects an unsupported file type", async () => {
    render(
      <ToolPage
        tool={byId("merge-pdf")}
        initialState={{
          status: "selected",
          input: { kind: "files", files: [{ name: "song.mp3", size: 10, type: "audio/mpeg" }] },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /run merge pdf/i }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/file type is not supported/i),
    );
  });

  it("validates input per tool", () => {
    const merge = byId("merge-pdf");
    expect(
      validateToolInput(merge, { kind: "files", files: [{ name: "a.pdf", size: 1, type: "" }] }),
    ).toBeNull();
    expect(validateToolInput(merge, { kind: "files", files: [] })).toMatch(/choose a file/i);
    expect(
      validateToolInput(byId("ai-pdf-summarizer"), {
        kind: "files",
        files: [
          { name: "a.pdf", size: 1, type: "" },
          { name: "b.pdf", size: 1, type: "" },
        ],
      }),
    ).toMatch(/one file at a time/i);
    expect(
      validateToolInput(byId("youtube-to-mp3"), { kind: "text", value: "not a link" }),
    ).toMatch(/https?:\/\//);
    expect(
      validateToolInput(byId("youtube-to-mp3"), { kind: "text", value: "https://youtu.be/x" }),
    ).toBeNull();
  });
});

describe("tool state machine", () => {
  const file = { name: "a.pdf", size: 1, type: "application/pdf" };
  const selected: ToolState = { status: "selected", input: { kind: "files", files: [file] } };

  it("starts empty when input is needed, ready when it isn't", () => {
    expect(initialToolState(true).status).toBe("empty");
    expect(initialToolState(false).status).toBe("selected");
  });

  it("walks the happy path", () => {
    let s = initialToolState(true);
    s = toolReducer(s, { type: "SELECT", input: { kind: "files", files: [file] } });
    expect(s.status).toBe("selected");
    s = toolReducer(s, { type: "VALIDATE" });
    expect(s.status).toBe("validating");
    s = toolReducer(s, { type: "START" });
    expect(s.status).toBe("processing");
    s = toolReducer(s, { type: "SUCCEED", output: { ok: 1 }, summary: "Done." });
    expect(s.status).toBe("success");
    expect(toolReducer(s, { type: "RESET" }).status).toBe("selected");
  });

  it("reaches the failure, unsupported and unavailable states", () => {
    const validating = toolReducer(selected, { type: "VALIDATE" });
    expect(toolReducer(validating, { type: "REJECT", message: "nope" }).status).toBe("unsupported");
    const processing = toolReducer(validating, { type: "START" });
    expect(toolReducer(processing, { type: "FAIL", message: "boom" }).status).toBe("failed");
    expect(
      toolReducer(processing, { type: "UNAVAILABLE", reason: "offline", message: "offline" })
        .status,
    ).toBe("unavailable");
  });

  it("ignores events that don't apply and never mutates while busy", () => {
    expect(toolReducer(selected, { type: "START" })).toBe(selected);
    const processing = toolReducer(toolReducer(selected, { type: "VALIDATE" }), { type: "START" });
    expect(toolReducer(processing, { type: "SELECT", input: { kind: "none" } })).toBe(processing);
    expect(toolReducer(processing, { type: "CLEAR" })).toBe(processing);
    expect(toolReducer(processing, { type: "RESET" })).toBe(processing);
  });

  it.each(TOOL_STATES)("renders the %s state", (status) => {
    const states: Record<string, ToolState> = {
      empty: { status: "empty", input: null },
      selected,
      validating: { status: "validating", input: selected.input },
      processing: { status: "processing", input: selected.input },
      success: { status: "success", input: selected.input, output: { a: 1 }, summary: "All done." },
      failed: { status: "failed", input: selected.input, message: "It broke." },
      unavailable: {
        status: "unavailable",
        input: selected.input,
        reason: "offline",
        message: "This tool needs an Internet connection. Connect and try again.",
      },
      unsupported: { status: "unsupported", input: selected.input, message: "Not supported." },
    };
    const { container } = render(
      <ToolStateView state={states[status]!} toolName="Merge PDF" acceptedTypes="PDF" />,
    );
    const panel = container.querySelector(`[data-state="${status}"]`);
    expect(panel).toBeTruthy();
    const region = within(panel as HTMLElement).getByRole("status");
    const expected: Record<string, RegExp> = {
      empty: /nothing selected yet/i,
      selected: /ready/i,
      validating: /checking your input/i,
      processing: /processing/i,
      success: /done/i,
      failed: /something went wrong/i,
      unavailable: /internet connection required/i,
      unsupported: /isn't supported/i,
    };
    expect(region.textContent).toMatch(expected[status]!);
    if (status === "validating" || status === "processing") {
      expect(within(panel as HTMLElement).getByRole("progressbar")).toBeTruthy();
    }
    if (status === "success") {
      expect(within(panel as HTMLElement).getByRole("button", { name: /download/i })).toBeTruthy();
    }
  });

  it("shows the phase message for a not-implemented tool and a sign-in link when auth is needed", () => {
    const { unmount } = render(
      <ToolStateView
        state={{
          status: "unavailable",
          input: null,
          reason: "not-implemented",
          message: "Merge PDF is coming in a later phase (05-pdf-tools-core.md).",
        }}
        toolName="Merge PDF"
      />,
    );
    expect(screen.getByText(/05-pdf-tools-core\.md/)).toBeTruthy();
    unmount();
    render(
      <ToolStateView
        state={{ status: "unavailable", input: null, reason: "auth-required", message: "Sign in." }}
        toolName="Dynamic QR Code"
      />,
    );
    expect(screen.getByRole("link", { name: /sign in/i }).getAttribute("href")).toBe("/auth/login");
  });
});

describe("/tools query params", () => {
  it("keeps known values and drops unknown ones", () => {
    expect(
      parseExplorerParams({
        q: "csv",
        category: "media",
        sub: "Audio",
        tags: "offline,ai",
        sort: "name",
      }),
    ).toEqual({ q: "csv", category: "media", sub: "Audio", tags: ["offline", "ai"], sort: "name" });
    expect(
      parseExplorerParams({ category: "nope", sub: "Audio", tags: "bogus", sort: "bogus" }),
    ).toEqual({ q: "", category: "", sub: "", tags: [], sort: "" });
  });
});

/** The FormData a stubbed `fetch` was called with. `mockRun`'s spy takes no typed arguments. */
function sentBody(fetchMock: ReturnType<typeof mockRun>): FormData {
  const call = fetchMock.mock.calls[0] as unknown as [string, { body: FormData }];
  return call[1].body;
}

/** 05-pdf-tools-core.md introduced per-tool options, rendered from the registry. */
describe("tool options", () => {
  const selected = (name: string, type = "application/pdf"): ToolState => ({
    status: "selected",
    input: { kind: "files", files: [{ name, size: 10, type }] },
  });

  it("says so when a tool has no options", () => {
    render(<ToolPage tool={byId("repair-pdf")} />);
    expect(screen.getByText(/no options for this tool yet/i)).toBeTruthy();
  });

  it("renders the registry's options for a tool that has them", () => {
    render(<ToolPage tool={byId("pdf-to-images")} />);
    const options = screen.getByTestId("tool-options");
    expect(within(options).getByLabelText(/image format/i)).toBeTruthy();
    expect(within(options).getByLabelText(/resolution/i)).toBeTruthy();
    expect(within(options).getByLabelText(/^pages$/i)).toBeTruthy();
    // JPG quality is conditional on the format, so it starts hidden.
    expect(within(options).queryByLabelText(/jpg quality/i)).toBeNull();
  });

  it("renders password options as password fields (06)", () => {
    render(<ToolPage tool={byId("remove-pdf-password")} />);
    const field = screen.getByLabelText(/current password/i) as HTMLInputElement;
    expect(field.type).toBe("password");
  });

  it("renders a multi-line option as a text area (06)", () => {
    render(<ToolPage tool={byId("fill-pdf-forms")} />);
    expect(screen.getByLabelText(/field values/i).tagName).toBe("TEXTAREA");
  });

  it("shows the signature pad only while 'Draw it' is chosen (06)", () => {
    render(<ToolPage tool={byId("sign-pdf")} />);
    expect(screen.getByTestId("signature-pad")).toBeTruthy();
    expect(screen.getByRole("button", { name: /clear signature/i })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.change(screen.getByLabelText(/^signature$/i), { target: { value: "type" } });
    expect(screen.queryByTestId("signature-pad")).toBeNull();
  });

  it("reveals a conditional option when its condition is met", () => {
    render(<ToolPage tool={byId("pdf-to-images")} />);
    fireEvent.change(screen.getByLabelText(/image format/i), { target: { value: "jpg" } });
    expect(screen.getByLabelText(/jpg quality/i)).toBeTruthy();
  });

  it("sends the visible option values with the run request", async () => {
    const fetchMock = mockRun({ ok: true, job: { id: "j", status: "success" }, files: [] });
    render(<ToolPage tool={byId("rotate-pdf-pages")} initialState={selected("a.pdf")} />);
    fireEvent.change(screen.getByLabelText(/rotate by/i), { target: { value: "180" } });
    fireEvent.change(screen.getByLabelText(/^pages$/i), { target: { value: "2-3" } });
    fireEvent.click(screen.getByRole("button", { name: /run rotate pdf pages/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = sentBody(fetchMock);
    expect(JSON.parse(body.get("options") as string)).toEqual({ angle: "180", pages: "2-3" });
  });

  it("omits an option that is hidden by its condition", async () => {
    const fetchMock = mockRun({ ok: true, job: { id: "j", status: "success" }, files: [] });
    render(<ToolPage tool={byId("split-pdf")} initialState={selected("a.pdf")} />);
    fireEvent.click(screen.getByRole("button", { name: /run split pdf/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = sentBody(fetchMock);
    expect(JSON.parse(body.get("options") as string)).toEqual({
      mode: "each-page",
      packaging: "zip",
    });
  });

  it("no longer shows the coming-soon banner for a tool this phase built", () => {
    render(<ToolPage tool={byId("merge-pdf")} />);
    expect(screen.queryByTestId("coming-soon")).toBeNull();
  });
});
