// @vitest-environment jsdom
//
// The `client` option type (12-dev-utility-tools.md): values only the browser knows — the
// user-agent string and the time zone — filled in by the page and shown read-only, so the server
// side of a tool can answer "what am I browsing with?" without the tool page knowing any tool.
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getToolOptions } from "@onestop/tool-registry";
import { ToolOptions } from "@/components/tools/ToolOptions";
import { readClientValue } from "@/components/tools/ClientValue";

describe("client options", () => {
  it("reads the browser's user agent and time zone", () => {
    expect(readClientValue("userAgent")).toBe(navigator.userAgent);
    expect(readClientValue("timeZone")).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(readClientValue("locale")).toBe(navigator.language);
  });

  it("fills the value in and reports it to the form once", async () => {
    const onChange = vi.fn();
    const options = getToolOptions("user-agent-viewer");
    expect(options.map((o) => o.type)).toContain("client");

    render(<ToolOptions options={options} values={{ userAgent: "" }} onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("userAgent", navigator.userAgent));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("shows the value read-only rather than taking it silently", async () => {
    render(
      <ToolOptions
        options={getToolOptions("user-agent-viewer")}
        values={{ userAgent: "Mozilla/5.0 (Testing)" }}
        onChange={() => {}}
      />,
    );
    const shown = await screen.findByTestId("client-option-userAgent");
    expect(shown.textContent).toBe("Mozilla/5.0 (Testing)");
    // Read-only: there is no input the user could edit.
    expect(shown.querySelector("input")).toBeNull();
  });

  it("is used by the Timestamp Converter for the visitor's own time zone", () => {
    const zone = getToolOptions("timestamp-converter").find((o) => o.id === "timeZone");
    expect(zone).toMatchObject({ type: "client", source: "timeZone" });
  });
});
