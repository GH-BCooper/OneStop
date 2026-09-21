// @vitest-environment jsdom
//
// The phase-16 screens (16-ai-assistant.md): the assistant workspace and the Settings AI card.
//
// Acceptance criteria that are things the *user has to see*, so they are tested here rather than
// only on the server:
//   * the assistant screen stays clean - no provider names or disclosure text - and says one short
//     "out of service" line (pointing at the app settings) only when nothing can answer;
//   * the Settings AI card is where the disclosure lives, and reads differently for a hosted
//     service than for the local one;
//   * an impossible request shows grouped Free/Paid recommendations instead of a made-up tool.
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiStatus, AssistantPlan } from "@onestop/types";
import { AssistantView } from "@/components/assistant/AssistantView";
import { SettingsView } from "@/components/settings/SettingsView";
import { readAiKey, writeAiKey } from "@/lib/preferences";

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
  it("keeps the screen clean when a runtime is available: no provider or disclosure text", async () => {
    fetchMock.mockResolvedValue(respond({ ok: true, status: HOSTED_STATUS }));
    render(<AssistantView />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("assistant-runtime")).toBeNull();
    expect(screen.queryByTestId("assistant-disclosure")).toBeNull();
    expect(screen.queryByTestId("assistant-out-of-service")).toBeNull();
    expect(document.body.textContent).not.toMatch(/third-party|groq|ollama/i);
  });

  it("shows one short 'out of service' line pointing at the app settings when nothing can answer", async () => {
    fetchMock.mockResolvedValue(
      respond({ ok: true, status: { ...LOCAL_STATUS, available: false, provider: null } }),
    );
    render(<AssistantView />);
    const notice = await screen.findByTestId("assistant-out-of-service");
    expect(notice.textContent).toMatch(/out of service/i);
    expect(notice.textContent).toMatch(/app settings/i);
    expect(notice.textContent).not.toMatch(/ollama|install|api key/i);
    expect(screen.getByRole("link", { name: /app settings/i }).getAttribute("href")).toBe(
      "/account?tab=app",
    );
  });

  it("shows rotating 'working on it' notices while the answer is on its way", async () => {
    let releasePlan: (value: unknown) => void = () => {};
    fetchMock.mockImplementation((url: string) =>
      String(url).includes("/status")
        ? Promise.resolve(respond({ ok: true, status: LOCAL_STATUS }))
        : new Promise((resolve) => {
            releasePlan = resolve;
          }),
    );
    render(<AssistantView />);
    fireEvent.change(screen.getByTestId("assistant-request"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    const notice = await screen.findByTestId("assistant-notice");
    expect(notice.textContent).toMatch(/figuring out/i);
    releasePlan(respond({ ok: true, plan: PLAN }));
    await screen.findByTestId("assistant-plan");
    expect(screen.queryByTestId("assistant-notice")).toBeNull();
  });

  it("turns the address in an out-of-credits reply into a link", async () => {
    const OUT_OF_CREDITS: AssistantPlan = {
      ok: true,
      intent: { kind: "chat", request: "hi", confidence: 0.5, needsFiles: false, source: "rules" },
      plan: null,
      message:
        "Out of credits. Visit https://console.groq.com/settings/billing to increase your credits usage.",
      rejected: [],
      recommendations: null,
      runtime: null,
    };
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes("/status")
          ? respond({ ok: true, status: LOCAL_STATUS })
          : respond({ ok: true, plan: OUT_OF_CREDITS }),
      ),
    );
    render(<AssistantView />);
    fireEvent.change(screen.getByTestId("assistant-request"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    const link = await screen.findByRole("link", {
      name: "https://console.groq.com/settings/billing",
    });
    expect(link.getAttribute("href")).toBe("https://console.groq.com/settings/billing");
    expect(document.body.textContent).toContain("to increase your credits usage.");
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
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

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
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

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

  it("chats normally for small talk instead of saying it cannot do that", async () => {
    const CHAT_REPLY: AssistantPlan = {
      ok: true,
      intent: { kind: "chat", request: "…", confidence: 0.5, needsFiles: false, source: "rules" },
      plan: null,
      message: "Hi! I'm the OneStop Assistant. Ask me to convert, merge or edit a file any time.",
      rejected: [],
      recommendations: null,
      runtime: null,
    };
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes("/status")
          ? respond({ ok: true, status: LOCAL_STATUS })
          : respond({ ok: true, plan: CHAT_REPLY }),
      ),
    );
    render(<AssistantView />);
    fireEvent.change(screen.getByTestId("assistant-request"), {
      target: { value: "Hi! What can you help me with?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() =>
      expect(screen.getByText(/ask me to convert, merge or edit a file/i)).toBeTruthy(),
    );
    // A chat reply is not a refusal: no "cannot do that" framing and no recommendations panel.
    expect(screen.queryByTestId("external-recommendations")).toBeNull();
    expect(screen.queryByText(/cannot do that/i)).toBeNull();
  });
});

describe("the Settings AI card", () => {
  const settingsFetch = (status: Partial<AiStatus> = {}) =>
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes("/api/assistant/status")
          ? respond({ ok: true, status: { ...HOSTED_STATUS, ollamaReachable: false, ...status } })
          : respond({ ok: true, settings: null }),
      ),
    );

  it("offers OneStop's own service first, and says whether it is available", async () => {
    settingsFetch();
    render(<SettingsView accountsEnabled={false} />);
    await waitFor(() =>
      expect(screen.getByTestId("onestop-ai-availability").textContent).toBe("(available)"),
    );
    expect(screen.getByRole("radio", { name: /use onestop ai service/i })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /your own ai service provider/i })).toBeTruthy();
    // The provider list is hidden until "your own" is chosen.
    expect(screen.queryByTestId("ai-runtime-groq")).toBeNull();
  });

  it("shows '(unavailable)' when OneStop's service cannot answer", async () => {
    settingsFetch({ available: false });
    render(<SettingsView accountsEnabled={false} />);
    await waitFor(() =>
      expect(screen.getByTestId("onestop-ai-availability").textContent).toBe("(unavailable)"),
    );
  });

  it("keeps a user-supplied key on the device and never sends it to the account", async () => {
    settingsFetch();
    render(<SettingsView accountsEnabled={false} />);

    fireEvent.click(await screen.findByRole("radio", { name: /your own ai service provider/i }));
    const groq = await screen.findByTestId("ai-runtime-groq");
    fireEvent.click(groq.querySelector("input") as HTMLInputElement);

    const disclosure = await screen.findByTestId("ai-disclosure");
    expect(disclosure.textContent).toContain("Groq's servers");

    const key = screen.getByLabelText(/^your .* api key$/i) as HTMLInputElement;
    expect(key.type).toBe("password");
    fireEvent.change(key, { target: { value: "gsk_my_own_key" } });

    expect(readAiKey("groq")).toBe("gsk_my_own_key");
    // The key is on the device only: no request carried it anywhere.
    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.stringify(init ?? {})).not.toContain("gsk_my_own_key");
    }
  });

  it("fills the key back in when the provider already has one saved", async () => {
    settingsFetch();
    writeAiKey("groq", "gsk_saved_earlier");
    render(<SettingsView accountsEnabled={false} />);
    fireEvent.click(await screen.findByRole("radio", { name: /your own ai service provider/i }));
    const groq = await screen.findByTestId("ai-runtime-groq");
    fireEvent.click(groq.querySelector("input") as HTMLInputElement);
    expect((screen.getByLabelText(/^your .* api key$/i) as HTMLInputElement).value).toBe(
      "gsk_saved_earlier",
    );
  });

  it("dims Ollama out when the server cannot reach one, and shows it as private when it can", async () => {
    settingsFetch({ ollamaReachable: false });
    const unreachable = render(<SettingsView accountsEnabled={false} />);
    fireEvent.click(await screen.findByRole("radio", { name: /your own ai service provider/i }));
    const dimmed = await screen.findByTestId("ai-runtime-ollama");
    await waitFor(() => expect(dimmed.getAttribute("aria-disabled")).toBe("true"));
    expect((dimmed.querySelector("input") as HTMLInputElement).disabled).toBe(true);
    unreachable.unmount();

    localStorage.clear();
    settingsFetch({ ollamaReachable: true, provider: "ollama", local: true });
    render(<SettingsView accountsEnabled={false} />);
    fireEvent.click(await screen.findByRole("radio", { name: /your own ai service provider/i }));
    const ollama = await screen.findByTestId("ai-runtime-ollama");
    await waitFor(() => expect(ollama.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(ollama.querySelector("input") as HTMLInputElement);
    const disclosure = await screen.findByTestId("ai-disclosure");
    expect(disclosure.textContent).toContain("entirely on your device");
    expect(screen.queryByLabelText(/^your .* api key$/i)).toBeNull();
  });

  it("really checks the key, and reports the provider's answer", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes("/api/assistant/status")
          ? respond({
              ok: true,
              status: {
                ...HOSTED_STATUS,
                ollamaReachable: false,
                checks: [
                  {
                    provider: "groq",
                    ok: false,
                    message: "Groq free tier rejected the API key. Check it and try again.",
                  },
                ],
              },
            })
          : respond({ ok: true, settings: null }),
      ),
    );
    render(<SettingsView accountsEnabled={false} />);
    fireEvent.click(await screen.findByRole("radio", { name: /your own ai service provider/i }));
    fireEvent.click(
      (await screen.findByTestId("ai-runtime-groq")).querySelector("input") as HTMLInputElement,
    );
    fireEvent.change(screen.getByLabelText(/^your .* api key$/i), {
      target: { value: "gsk_wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: /check connection/i }));
    const result = await screen.findByTestId("ai-status");
    expect(result.textContent).toContain("rejected the API key");
    // The check itself sent the key in the header, not in the URL.
    const call = fetchMock.mock.calls
      .filter(([u]) => String(u).includes("/api/assistant/status"))
      .at(-1)!;
    expect(String(call[0])).not.toContain("gsk_wrong");
  });
});
