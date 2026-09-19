"use client";

// Camera QR scanning (11-qr-tools.md).
//
// Nothing here leaves the device: frames are read from the camera into a canvas and decoded in
// the page. `BarcodeDetector` is used where the browser has it (Chrome, Edge, Android) because it
// is hardware-accelerated; everywhere else jsQR does the same job in JavaScript. The uploaded-image
// path is the normal tool form below this panel and goes through the server executor instead.
import { Button, Card } from "@onestop/ui";
import jsQR from "jsqr";
import { useCallback, useEffect, useRef, useState } from "react";

/** How often a frame is decoded. Faster than this just burns battery. */
const FRAME_INTERVAL_MS = 180;

export interface QRScannerProps {
  /** Called with the decoded text each time a *new* code is seen. */
  onResult?: (text: string) => void;
}

type Status = "idle" | "starting" | "scanning" | "denied" | "unsupported" | "error";

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

function barcodeDetector(): BarcodeDetectorLike | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!ctor) return null;
  try {
    return new ctor({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

/** Turns a getUserMedia rejection into something the user can act on (master plan §22). */
export function cameraMessage(err: unknown): { status: Status; message: string } {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      status: "denied",
      message:
        "Camera access is needed to scan. Allow the camera for this site in your browser's address bar, then try again — or upload a photo of the code instead.",
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return {
      status: "unsupported",
      message: "No camera was found on this device. Upload a photo of the code instead.",
    };
  }
  if (name === "NotReadableError") {
    return {
      status: "error",
      message: "The camera is already in use by another app. Close it and try again.",
    };
  }
  return {
    status: "error",
    message: "The camera could not be started. Upload a photo of the code instead.",
  };
}

/**
 * What must be true before the camera can even be asked (18-pwa-offline.md).
 *
 * Both cases are ones the installed app can hit: a PWA served over plain http from a LAN address
 * has no secure context, so `mediaDevices` is missing entirely and the browser's own error would be
 * a bare TypeError. Returning the reason up front keeps the message actionable (master plan §22).
 */
export function cameraPreflight(env: {
  hasMediaDevices: boolean;
  secureContext: boolean;
}): { ok: true } | { ok: false; status: Status; message: string } {
  if (!env.secureContext) {
    return {
      ok: false,
      status: "unsupported",
      message:
        "Camera scanning needs a secure connection. Open OneStop over https (or on localhost) — or upload a photo of the code instead, which works anywhere.",
    };
  }
  if (!env.hasMediaDevices) {
    return {
      ok: false,
      status: "unsupported",
      message:
        "This browser cannot open a camera. Upload a photo of the code instead — that works everywhere.",
    };
  }
  return { ok: true };
}

export function QRScanner({ onResult }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRef = useRef<string>("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<string[]>([]);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus((current) => (current === "scanning" || current === "starting" ? "idle" : current));
  }, []);

  // A camera left running after the page changes is both a battery drain and a privacy problem.
  useEffect(() => stop, [stop]);

  const handle = useCallback(
    (text: string) => {
      if (text === "" || text === lastRef.current) return;
      lastRef.current = text;
      setResults((current) => [text, ...current.filter((t) => t !== text)].slice(0, 10));
      onResult?.(text);
    },
    [onResult],
  );

  const start = useCallback(async () => {
    setMessage("");
    setStatus("starting");
    const preflight = cameraPreflight({
      hasMediaDevices:
        typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia),
      // `isSecureContext` is true on localhost and over https, which covers the installed app.
      secureContext: typeof window === "undefined" || window.isSecureContext !== false,
    });
    if (!preflight.ok) {
      setStatus(preflight.status);
      setMessage(preflight.message);
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
    } catch (err) {
      const outcome = cameraMessage(err);
      setStatus(outcome.status);
      setMessage(outcome.message);
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) {
      stop();
      return;
    }
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      // Autoplay refusal is not fatal: the poster frame still updates once the user interacts.
    }
    setStatus("scanning");

    const detector = barcodeDetector();
    timerRef.current = setInterval(() => {
      void (async () => {
        const canvas = canvasRef.current;
        const current = videoRef.current;
        if (!canvas || !current || current.videoWidth === 0) return;
        if (detector) {
          try {
            const found = await detector.detect(current);
            if (found.length > 0 && found[0]) {
              handle(found[0].rawValue);
              return;
            }
          } catch {
            // Fall through to the JS decoder for this frame.
          }
        }
        const width = Math.min(640, current.videoWidth);
        const height = Math.round((current.videoHeight / current.videoWidth) * width);
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(current, 0, 0, width, height);
        const frame = ctx.getImageData(0, 0, width, height);
        try {
          const found = jsQR(frame.data, width, height, { inversionAttempts: "dontInvert" });
          if (found?.data) handle(found.data);
        } catch {
          // A frame that cannot be decoded is the normal case, not an error.
        }
      })();
    }, FRAME_INTERVAL_MS);
  }, [handle, stop]);

  const scanning = status === "scanning" || status === "starting";

  return (
    <Card className="flex flex-col gap-3" data-testid="qr-scanner">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Scan with the camera</h2>
        <p className="text-sm text-fg-muted">
          The picture never leaves this device — the code is decoded in your browser.
        </p>
      </div>

      <div className="relative overflow-hidden rounded-lg border border-border bg-surface-muted">
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label="Camera preview"
          className={`aspect-video w-full object-cover ${scanning ? "" : "hidden"}`}
        />
        {!scanning && (
          <div className="flex aspect-video w-full items-center justify-center text-sm text-fg-muted">
            Camera off
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {message && (
        <p role="status" className="text-sm text-danger" data-testid="qr-scanner-message">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {scanning ? (
          <Button variant="secondary" onClick={stop}>
            Stop the camera
          </Button>
        ) : (
          <Button onClick={() => void start()}>Start the camera</Button>
        )}
        {results.length > 0 && (
          <Button variant="ghost" onClick={() => setResults([])}>
            Clear results
          </Button>
        )}
      </div>

      {results.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="qr-scanner-results">
          {results.map((text) => (
            <li key={text} className="rounded-md bg-surface-muted p-3 text-sm break-all">
              {/^https?:\/\//i.test(text) ? (
                <a
                  href={text}
                  rel="noreferrer noopener"
                  target="_blank"
                  className="text-primary underline"
                >
                  {text}
                </a>
              ) : (
                <span className="font-mono">{text}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
