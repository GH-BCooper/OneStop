"use client";

// Before/after comparison with a draggable divider (21-roadmap-expansion.md, roadmap §7.5).
//
// Pure CSS `clip-path` plus one drag handle — no library. It is keyboard-operable (arrow keys move
// the divider, Home/End jump to the ends) and exposed as a slider to assistive technology, because a
// visual-only comparison would be no comparison at all for some people.
import { useCallback, useEffect, useId, useRef, useState } from "react";

export interface CompareSliderProps {
  /** The original, shown on the left. */
  beforeSrc: string;
  /** The result, shown on the right. */
  afterSrc: string;
  beforeLabel?: string;
  afterLabel?: string;
  /** Starting divider position, 0-100. */
  initial?: number;
  className?: string;
}

export function CompareSlider({
  beforeSrc,
  afterSrc,
  beforeLabel = "Before",
  afterLabel = "After",
  initial = 50,
  className,
}: CompareSliderProps) {
  const [position, setPosition] = useState(Math.min(100, Math.max(0, initial)));
  const [dragging, setDragging] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const labelId = useId();

  const moveTo = useCallback((clientX: number) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    setPosition(Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100)));
  }, []);

  // Pointer capture is on the window, so a fast drag that leaves the frame keeps working.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      event.preventDefault();
      moveTo(event.clientX);
    };
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, moveTo]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 2;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setPosition((p) => Math.max(0, p - step));
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setPosition((p) => Math.min(100, p + step));
    } else if (event.key === "Home") {
      event.preventDefault();
      setPosition(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setPosition(100);
    }
  };

  return (
    <figure className={`m-0 ${className ?? ""}`}>
      <div
        ref={frame}
        className="relative w-full overflow-hidden rounded-md border border-border bg-surface-muted select-none"
        onPointerDown={(event) => {
          // A click anywhere in the frame moves the divider there, which is what people expect.
          setDragging(true);
          moveTo(event.clientX);
        }}
      >
        {/* The "after" image is the base layer; the "before" is clipped over it. Both are plain
            <img> tags on purpose: the sources are blob: and /api/files URLs of the visitor's own
            result, which next/image can neither optimise nor be allowed to fetch. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={afterSrc} alt={afterLabel} className="block w-full" draggable={false} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={beforeSrc}
          alt={beforeLabel}
          draggable={false}
          className="absolute inset-0 block h-full w-full object-cover"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        />
        <span className="pointer-events-none absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
          {beforeLabel}
        </span>
        <span className="pointer-events-none absolute top-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
          {afterLabel}
        </span>
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
          style={{ left: `${position}%` }}
        />
        <button
          type="button"
          role="slider"
          aria-label={`Comparison divider: drag to reveal ${beforeLabel} or ${afterLabel}`}
          aria-describedby={labelId}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(position)}
          aria-valuetext={`${Math.round(position)}% ${beforeLabel}`}
          onKeyDown={onKeyDown}
          onPointerDown={(event) => {
            event.stopPropagation();
            setDragging(true);
          }}
          className="absolute top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full border border-white/70 bg-black/55 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          style={{ left: `${position}%` }}
        >
          <span aria-hidden="true" className="text-xs">
            ⇤⇥
          </span>
        </button>
      </div>
      <figcaption id={labelId} className="mt-2 text-xs text-fg-muted">
        Drag the handle — or focus it and use the arrow keys — to compare {beforeLabel.toLowerCase()} with{" "}
        {afterLabel.toLowerCase()}.
      </figcaption>
    </figure>
  );
}
