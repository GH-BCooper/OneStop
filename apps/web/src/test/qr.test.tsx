// @vitest-environment jsdom
//
// Browser-side QR tests (11-qr-tools.md): the camera path's permission handling, the hosted
// landing page, and the dynamic-code manager's edit/pause/delete calls.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cameraMessage, QRScanner } from "@/components/qr/QRScanner";
import { QRLandingPage } from "@/components/qr/QRLandingPage";
import { DynamicQRManager, type QrCodeStats } from "@/components/qr/DynamicQRManager";

function mediaDevices(getUserMedia: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
}

function domError(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

const CODE: QrCodeStats = {
  id: "abcde23456",
  title: "Poster",
  kind: "redirect",
  shortUrl: "http://localhost:3000/q/abcde23456",
  destination: "https://example.com/first",
  active: true,
  scans: 3,
  scansLast7Days: 3,
  lastScannedAt: "2026-09-18T10:00:00.000Z",
  createdAt: "2026-09-01T10:00:00.000Z",
  destinationChanges: 0,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("QRScanner", () => {
  it("explains a refused camera instead of crashing", async () => {
    mediaDevices(() => Promise.reject(domError("NotAllowedError")));
    render(<QRScanner />);
    fireEvent.click(screen.getByRole("button", { name: /start the camera/i }));

    const message = await screen.findByTestId("qr-scanner-message");
    expect(message.textContent).toMatch(/camera access is needed/i);
    expect(message.textContent).toMatch(/upload a photo/i);
    // The button is still there to try again once permission is granted.
    expect(screen.getByRole("button", { name: /start the camera/i })).toBeTruthy();
  });

  it("explains a device with no camera", async () => {
    mediaDevices(() => Promise.reject(domError("NotFoundError")));
    render(<QRScanner />);
    fireEvent.click(screen.getByRole("button", { name: /start the camera/i }));
    expect((await screen.findByTestId("qr-scanner-message")).textContent).toMatch(
      /no camera was found/i,
    );
  });

  it("explains a browser that cannot open a camera at all", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    render(<QRScanner />);
    fireEvent.click(screen.getByRole("button", { name: /start the camera/i }));
    expect((await screen.findByTestId("qr-scanner-message")).textContent).toMatch(
      /cannot open a camera/i,
    );
  });

  it("maps each camera failure to its own message", () => {
    expect(cameraMessage(domError("NotAllowedError")).status).toBe("denied");
    expect(cameraMessage(domError("NotReadableError")).message).toMatch(/already in use/i);
    expect(cameraMessage(new Error("boom")).status).toBe("error");
  });
});

describe("QRLandingPage", () => {
  it("renders every block type", () => {
    render(
      <QRLandingPage
        code="abcde23456"
        scans={4}
        page={{
          title: "Our cafe",
          subtitle: "Open daily",
          accent: "#16a34a",
          blocks: [
            { type: "heading", text: "Today" },
            { type: "text", text: "Soup of the day" },
            { type: "link", text: "See the menu", url: "https://example.com/menu" },
            { type: "image", text: "Our shop", data: "data:image/png;base64,AAAA" },
            {
              type: "file",
              fileName: "menu.pdf",
              data: "data:application/pdf;base64,AAAA",
              size: 400,
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Our cafe");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Today");
    expect(screen.getByRole("link", { name: "See the menu" }).getAttribute("href")).toBe(
      "https://example.com/menu",
    );
    expect(screen.getByAltText("Our shop")).toBeTruthy();
    expect(screen.getByText(/4 scans/)).toBeTruthy();
  });

  it("ignores an accent colour that is not a plain hex value", () => {
    render(
      <QRLandingPage
        page={{ title: "x", accent: "url(evil)", blocks: [{ type: "text", text: "hi" }] }}
      />,
    );
    // jsdom normalises a hex colour to rgb(): the point is that the fallback, not the input, won.
    expect(screen.getByRole("heading", { level: 1 }).getAttribute("style")).toBe(
      "color: rgb(37, 99, 235);",
    );
  });
});

describe("DynamicQRManager", () => {
  function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      return new Response(JSON.stringify(handler(url, init)), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("lists codes and re-points one without touching its URL", async () => {
    const fetchMock = mockFetch((url, init) => {
      if (init?.method === "PATCH") {
        return {
          ok: true,
          code: { ...CODE, destination: "https://example.com/second", destinationChanges: 1 },
        };
      }
      return { ok: true, codes: [CODE] };
    });

    render(<DynamicQRManager />);
    await screen.findByTestId("qr-manager-row");
    expect(screen.getByText(/Opens https:\/\/example.com\/first/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /change destination/i }));
    fireEvent.change(screen.getByLabelText(/new destination/i), {
      target: { value: "https://example.com/second" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save destination/i }));

    await waitFor(() =>
      expect(screen.getByText(/Opens https:\/\/example.com\/second/)).toBeTruthy(),
    );
    // The short URL — the thing printed into the QR image — is untouched.
    expect(screen.getByRole("link", { name: CODE.shortUrl }).getAttribute("href")).toBe(
      CODE.shortUrl,
    );
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patch?.[0]).toBe(`/api/qr/links/${CODE.id}`);
  });

  it("pauses a code", async () => {
    mockFetch((url, init) => {
      if (init?.method === "PATCH") return { ok: true, code: { ...CODE, active: false } };
      return { ok: true, codes: [CODE] };
    });
    render(<DynamicQRManager />);
    await screen.findByTestId("qr-manager-row");
    fireEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    await waitFor(() => expect(screen.getByText(/paused/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /resume/i })).toBeTruthy();
  });

  it("says so when the list cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    render(<DynamicQRManager />);
    expect((await screen.findByRole("status")).textContent).toMatch(/could not be loaded/i);
  });

  it("hides the editing controls in analytics mode", async () => {
    mockFetch(() => ({ ok: true, codes: [CODE] }));
    render(<DynamicQRManager mode="analytics" />);
    await screen.findByTestId("qr-manager-row");
    expect(screen.queryByRole("button", { name: /change destination/i })).toBeNull();
    expect(screen.getByText(/3 in the last 7 days/)).toBeTruthy();
  });
});
