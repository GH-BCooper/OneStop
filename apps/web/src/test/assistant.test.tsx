// @vitest-environment jsdom
//
// The phase-16 screens (16-ai-assistant.md): the assistant workspace and the Settings AI card.
//
// Two of this phase's acceptance criteria are things the *user has to see*, so they are tested
// here rather than only on the server:
//   * the third-party disclosure appears before a hosted runtime is used, and reads differently
//     from the local one;
//   * an impossible request shows grouped Free/Paid recommendations instead of a made-up tool.
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiStatus, AssistantPlan } from "@onestop/types";
import { AssistantView } from "@/components/assistant/AssistantView";
import { SettingsView } from "@/components/settings/SettingsView";
import { readAiKey } from "@/lib/preferences";

const fetchMock = vi.fn();

const LOCAL_STATUS: AiStatus = {
  available: true,
  provider: "ollama",
  providerLabel: "Ollama (local)",
  model: "llama3.2",
  local: true,
  disclosure: "Runs entirely on your device — nothing leaves your machine, and it works offline.",
  message: "Ollama is running at http://localhost:11434 with llama3.2.",
  configured: ["ollama"],
  preferred: "ollama",
};

const HOSTED_STATUS: AiStatus = {
  available: true,
  provider: "groq",
  providerLabel: "Groq free tier",
  model: "llama-3.3-70b-versatile",
  local: false,
  disclosure:
    "Runs on Groq's servers — the text and file contents you send are transmitted to Groq for processing, and it needs an internet connection.",
  message: "Groq free tier is ready with llama-3.3-70b-versatile.",
  configured: ["ollama", "groq"],
  preferred: "groq",
};

const PLAN: AssistantPlan = {
  ok: true,
  intent: { kind: "tool-chain", request: "…", confidence: 0.85, needsFiles: true, source: "rules" },
  plan: {
    steps: [
      { toolId: "delete-pdf-pages", options: { pages: "1-2" } },
      { toolId: "pdf-to-excel", options: {} },
      { toolId: "file-compressor", options: {} },
    ],
    explanation: "Here is the plan. The steps are in a different order from your sentence…",
  },
  message: null,
  rejected: [],
  recommendations: null,
  runtime: null,
};

const UNSUPPORTED: AssistantPlan = {
  ok: false,
  intent: { kind: "unsupported", request: "…", confidence: 1, needsFiles: false, source: "rules" },
  plan: null,
  message: "OneStop cannot do that itself.",
  rejected: [],
  recommendations: {
    topic: "3D modelling and rendering",
    free: [
      {
        name: "Blender",
        url: "https://www.blender.org/",
        purpose: "Full 3D modelling and rendering.",
        limitation: "Desktop application with a steep learning curve.",
        pricing: "free",
      },
    ],
    paid: [
      {
        name: "Autodesk Fusion",
        url: "https://www.autodesk.com/products/fusion-360/",
        purpose: "Professional parametric CAD.",
        limitation: "Subscription.",
        pricing: "paid",
      },
    ],
  },
  runtime: null,
};

function respond(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 422, json: async () => body };
}

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the assistant workspace", () => {
  it("shows the local runtime and its 'nothing leaves your machine' disclosure", async () => {
    fetchMock.mockResolvedValue(respond({ ok: true, status: LOCAL_STATUS }));
    render(<AssistantView />);
    const disclosure = await screen.findByTestId("assistant-disclosure");
    expect(disclosure.textContent).toContain("entirely on your device");
    expect(screen.getByTestId("assistant-runtime").textContent).toContain("On this device");
  });

  it("says out loud when the runtime is a third-party service", async () => {
    fetchMock.mockResolvedValue(respond({ ok: true, status: HOSTED_STATUS }));
    render(<AssistantView />);
    const disclosure = await screen.findByTestId("assistant-disclosure");
    expect(disclosure.textContent).toContain("Groq's servers");
    expect(disclosure.textContent).toContain("transmitted to Groq");
    expect(screen.getByTestId("assistant-runtime").textContent).toContain("Third-party service");
  });

  it("still works, and says so, when no runtime is configured", async () => {
    fetchMock.mockResolvedValue(
      respond({ ok: true, status: { ...LOCAL_STATUS, available: false, provider: null } }),
    );
    render(<AssistantView />);
    await waitFor(() =>
      expect(screen.getByTestId("assistant-runtime").textContent).toContain("Not configured"),
    );
    expect(screen.getByTestId("assistant-runtime").textContent).toContain(
      "built-in offline method",
    );
  });

  it("shows a plan as numbered OneStop tools before anything is run", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes("/status")
          ? respond({ ok: true, status: LOCAL_STATUS })
          : respond({ ok: true, plan: PLAN }),
      ),
    );
    render(<AssistantView />);
    fireEvent.change(screen.getByTestId("assistant-request"), {
      target: { value: "Convert this PDF to Excel, remove the first 2 pages, then compress it" },
    });
    fireEvent.click(screen.getByRole("button", { name: /plan it/i }));

    const panel = await screen.findByTestId("assistant-plan");
    expect(panel.textContent).toContain("Delete PDF Pages");
    expect(panel.textContent).toContain("PDF → Excel");
    expect(panel.textContent).toContain("File Compressor");
    expect(panel.textContent).toContain("pages: 1-2");
    // Nothing ran: the only calls so far are the status check and the plan.
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("/run"))).toBe(true);
  });

  it("answers an impossible request with grouped Free and Paid recommendations", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes("/status")
          ? respond({ ok: true, status: LOCAL_STATUS })
          : respond({ ok: true, plan: UNSUPPORTED }),
      ),
    );
    render(<AssistantView />);
    fireEvent.change(screen.getByTestId("assistant-request"), {
      target: { value: "generate a 3D model of a house" },
    });
    fireEvent.click(screen.getByRole("button", { name: /plan it/i }));

    const panel = await screen.findByTestId("external-recommendations");
    expect(panel.textContent).toContain("3D modelling");
    expect(panel.textContent).toContain("external services");
    const free = screen.getByTestId("recommendations-free");
    const paid = screen.getByTestId("recommendations-paid");
    expect(free.textContent).toContain("Blender");
    expect(free.textContent).toContain("Limitation:");
    expect(paid.textContent).toContain("Autodesk Fusion");
    expect(free.textContent).not.toContain("Autodesk");
    expect(screen.getByRole("link", { name: "Blender" }).getAttribute("href")).toBe(
      "https://www.blender.org/",
    );
  });
});

describe("the Settings AI card", () => {
  it("keeps a user-supplied key on the device and never sends it to the account", async () => {
    fetchMock.mockResolvedValue(respond({ ok: true, settings: null }));
    render(<SettingsView accountsEnabled={false} />);

    fireEvent.change(await screen.findByLabelText(/preferred runtime/i), {
      target: { value: "groq" },
    });

    const disclosure = await screen.findByTestId("ai-disclosure");
    expect(disclosure.textContent).toContain("Groq's servers");

    const key = screen.getByLabelText(/api key/i) as HTMLInputElement;
    expect(key.type).toBe("password");
    fireEvent.change(key, { target: { value: "gsk_my_own_key" } });

    expect(readAiKey("groq")).toBe("gsk_my_own_key");
    // The key is on the device only: no request carried it anywhere.
    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.stringify(init ?? {})).not.toContain("gsk_my_own_key");
    }
  });

  it("shows the local runtime as private, with no key field", async () => {
    fetchMock.mockResolvedValue(respond({ ok: true, settings: null }));
    render(<SettingsView accountsEnabled={false} />);
    fireEvent.change(await screen.findByLabelText(/preferred runtime/i), {
      target: { value: "ollama" },
    });
    const disclosure = await screen.findByTestId("ai-disclosure");
    expect(disclosure.textContent).toContain("entirely on your device");
    expect(screen.queryByLabelText(/api key/i)).toBeNull();
  });
});
