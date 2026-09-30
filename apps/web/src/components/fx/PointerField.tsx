"use client";

// Drives the spotlight on cards: `.os-glow` elements get their `--mx/--my` here, so one pointer
// listener serves the whole app. (This used to also paint a canvas of drifting, line-joined dots
// behind every page; that backdrop was removed on request because it was distracting.)
import { useEffect } from "react";

export function PointerField() {
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const target = (e.target as Element | null)?.closest?.<HTMLElement>(".os-glow") ?? null;
      if (!target) return;
      const box = target.getBoundingClientRect();
      target.style.setProperty("--mx", `${e.clientX - box.left}px`);
      target.style.setProperty("--my", `${e.clientY - box.top}px`);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return null;
}
