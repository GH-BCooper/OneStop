"use client";

// Drawing pad for Sign PDF (06-pdf-tools-advanced.md).
//
// Mouse, pen and touch all go through pointer events. The drawing is exported as a transparent
// PNG data URL on every stroke end, so the value in the form is always current. Keyboard and
// screen-reader users are offered the "Type my name" signature, which needs no drawing.
import { useEffect, useRef, useState } from "react";

export interface SignaturePadProps {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  onChange(value: string): void;
}

const WIDTH = 480;
const HEIGHT = 160;

export function SignaturePad({ id, label, value, disabled, onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(value === "");
  const inked = useRef(false);

  useEffect(() => {
    if (value === "") {
      const ctx = canvasRef.current?.getContext("2d");
      ctx?.clearRect(0, 0, WIDTH, HEIGHT);
      inked.current = false;
      setEmpty(true);
    }
  }, [value]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / Math.max(rect.width, 1)) * WIDTH,
      y: ((e.clientY - rect.top) / Math.max(rect.height, 1)) * HEIGHT,
    };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const next = point(e);
    ctx.strokeStyle = "#0b1f5c";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    last.current = next;
    inked.current = true;
    setEmpty(false);
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    const canvas = canvasRef.current;
    if (canvas && inked.current) onChange(canvas.toDataURL("image/png"));
  };

  const clear = () => {
    canvasRef.current?.getContext("2d")?.clearRect(0, 0, WIDTH, HEIGHT);
    inked.current = false;
    setEmpty(true);
    onChange("");
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-1 sm:col-span-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <canvas
        id={id}
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={empty ? `${label}: empty` : `${label}: signature drawn`}
        data-testid="signature-pad"
        className="h-40 w-full max-w-[480px] touch-none rounded-md border border-dashed border-border bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Clear signature"
          className="text-sm text-accent underline disabled:opacity-50"
          onClick={clear}
          disabled={disabled || empty}
        >
          Clear
        </button>
        <p className="text-sm text-fg-muted">
          Draw with a mouse, pen or finger. Prefer the keyboard? Choose “Type my name”.
        </p>
      </div>
    </div>
  );
}
