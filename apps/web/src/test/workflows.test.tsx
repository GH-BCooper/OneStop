// @vitest-environment jsdom
//
// The phase-15 screens (15-workflows.md): the builder's build-time rejection of an incompatible
// chain, the list, and the guest's on-device persistence — "save a workflow, reload the page,
// confirm it is still there and editable" without needing an account or a database.
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowBuilder } from "@/components/workflows/WorkflowBuilder";
import { WorkflowEditor } from "@/components/workflows/WorkflowEditor";
import { WorkflowsView } from "@/components/workflows/WorkflowsView";
import { deleteLocalWorkflow, readLocalWorkflows, saveLocalWorkflow } from "@/lib/workflows";
import { navigation, session } from "./setup";

const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function saveButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /save workflow/i }) as HTMLButtonElement;
}

function chooseTool(index: number, toolId: string) {
  const step = screen.getByTestId(`workflow-step-${index}`);
  const select = step.querySelector("select")!;
  // The incompatible tool is only in the list once "show every tool" is on.
  const showAll = step.querySelector('input[type="checkbox"]');
  if (showAll) fireEvent.click(showAll);
  fireEvent.change(select, { target: { value: toolId } });
}

describe("the workflow builder", () => {
  it("rejects an incompatible chain at build time, with a specific message", async () => {
    render(<WorkflowBuilder />);
    fireEvent.click(screen.getByRole("button", { name: /add step/i }));
    chooseTool(0, "background-removal");
    fireEvent.click(screen.getByRole("button", { name: /add step/i }));
    chooseTool(1, "audio-converter");

    const issues = await screen.findByTestId("workflow-step-1-issues");
    expect(issues.textContent).toContain("Background Removal");
    expect(issues.textContent).toContain("Audio Converter");
    // Nothing can be saved while the chain cannot work.
    expect(saveButton().disabled).toBe(true);
  });

  it("accepts a compatible chain and offers to run it", async () => {
    render(<WorkflowBuilder />);
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Scans" } });
    fireEvent.click(screen.getByRole("button", { name: /add step/i }));
    chooseTool(0, "image-to-pdf");
    fireEvent.click(screen.getByRole("button", { name: /add step/i }));
    chooseTool(1, "compress-pdf");

    expect(screen.queryByTestId("workflow-step-1-issues")).toBeNull();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(screen.getByTestId("workflow-runner")).toBeTruthy();
  });

  it("fills the builder from one of the master plan examples", async () => {
    render(<WorkflowBuilder />);
    fireEvent.click(screen.getByRole("button", { name: /csv → clean → excel/i }));
    await waitFor(() => expect(screen.getByTestId("workflow-step-1")).toBeTruthy());
    expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe(
      "CSV → Clean → Excel",
    );
  });

  it("saves a guest's workflow on this device and reopens it, editable", async () => {
    const first = render(<WorkflowBuilder />);
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Scans to PDF" } });
    fireEvent.click(screen.getByRole("button", { name: /add step/i }));
    chooseTool(0, "image-to-pdf");
    fireEvent.click(screen.getByRole("button", { name: /save workflow/i }));

    await waitFor(() => expect(readLocalWorkflows()).toHaveLength(1));
    const saved = readLocalWorkflows()[0]!;
    expect(saved.name).toBe("Scans to PDF");
    expect(saved.steps).toEqual([{ toolId: "image-to-pdf" }]);
    expect(navigation.push).toHaveBeenCalledWith(`/workflows/${saved.id}`);
    // Nothing was sent to the server: a guest's workflow never leaves the device.
    expect(fetchMock).not.toHaveBeenCalled();

    // "Reload the page": a fresh editor mounted on the saved id finds it and can change it.
    first.unmount();
    render(<WorkflowEditor id={saved.id} />);
    const name = await screen.findByDisplayValue("Scans to PDF");
    fireEvent.change(name, { target: { value: "Scans to PDF v2" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(readLocalWorkflows()[0]?.name).toBe("Scans to PDF v2"));
    expect(readLocalWorkflows()).toHaveLength(1);
  });
});

describe("the workflow list", () => {
  it("shows a guest's saved workflows with their chain", async () => {
    saveLocalWorkflow({
      name: "Cutouts",
      description: "For the shop",
      steps: [{ toolId: "background-removal" }, { toolId: "image-resizer" }],
    });
    render(<WorkflowsView accountsEnabled />);
    const list = await screen.findByTestId("workflow-list");
    expect(list.textContent).toContain("Cutouts");
    expect(list.textContent).toContain("Background Removal → Image Resizer");
    expect(list.textContent).toContain("This device");
  });

  it("offers the four examples when there is nothing saved yet", async () => {
    render(<WorkflowsView accountsEnabled />);
    expect(await screen.findByText(/no workflows yet/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /images → pdf → compress/i })).toBeTruthy();
  });

  it("reads a signed-in user's workflows from the account", async () => {
    session.data = { user: { id: "u1", email: "sam@example.com", name: "Sam" } };
    session.status = "authenticated";
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        workflows: [
          {
            id: "w1",
            userId: "u1",
            name: "From the account",
            description: null,
            steps: [{ toolId: "merge-pdf" }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    });

    render(<WorkflowsView accountsEnabled />);
    const list = await screen.findByTestId("workflow-list");
    expect(list.textContent).toContain("From the account");
    expect(list.textContent).toContain("Account");
    expect(fetchMock).toHaveBeenCalledWith("/api/workflows", expect.anything());
  });
});

describe("on-device workflow storage", () => {
  it("survives a reload, keeps one row per id and can be deleted", () => {
    const first = saveLocalWorkflow({ name: "A", steps: [{ toolId: "merge-pdf" }] });
    saveLocalWorkflow({ name: "B", steps: [{ toolId: "compress-pdf" }] });
    expect(
      readLocalWorkflows()
        .map((w) => w.name)
        .sort(),
    ).toEqual(["A", "B"]);

    saveLocalWorkflow({ name: "A renamed", steps: [{ toolId: "merge-pdf" }] }, first.id);
    expect(readLocalWorkflows()).toHaveLength(2);
    expect(readLocalWorkflows().find((w) => w.id === first.id)?.name).toBe("A renamed");

    deleteLocalWorkflow(first.id);
    expect(readLocalWorkflows().map((w) => w.name)).toEqual(["B"]);
  });

  it("ignores rubbish in storage rather than throwing", () => {
    localStorage.setItem("onestop-workflows", "{not json");
    expect(readLocalWorkflows()).toEqual([]);
    localStorage.setItem("onestop-workflows", JSON.stringify([{ nope: true }, 42]));
    expect(readLocalWorkflows()).toEqual([]);
  });
});
