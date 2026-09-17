// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Badge, Button, Card, Input, Modal, Tabs, colors } from "./index";

afterEach(cleanup);

describe("@onestop/ui", () => {
  it("Button defaults to type=button and applies the variant", () => {
    render(<Button variant="danger">Delete</Button>);
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.className).toContain("bg-danger");
  });

  it("Card and Badge render children", () => {
    render(
      <Card>
        <Badge tone="success">Online</Badge>
      </Card>,
    );
    expect(screen.getByText("Online").className).toContain("text-success");
  });

  it("Input links its label and error message", () => {
    render(<Input label="Email" error="Required" />);
    const input = screen.getByLabelText("Email");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Required",
    );
  });

  it("Modal renders a labelled dialog and closes on Escape", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open onClose={onClose} title="Confirm">
        Body
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "Confirm" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<Modal open={false} onClose={onClose} title="Confirm" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Tabs switch on click and arrow keys", () => {
    render(
      <Tabs
        label="Sections"
        items={[
          { id: "a", label: "First", content: "Panel A" },
          { id: "b", label: "Second", content: "Panel B" },
        ]}
      />,
    );
    expect(screen.getByRole("tabpanel").textContent).toBe("Panel A");
    fireEvent.click(screen.getByRole("tab", { name: "Second" }));
    expect(screen.getByRole("tabpanel").textContent).toBe("Panel B");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Second" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "First" }).getAttribute("aria-selected")).toBe("true");
  });

  it("both themes define the same color tokens", () => {
    expect(Object.keys(colors.dark).sort()).toEqual(Object.keys(colors.light).sort());
  });
});
