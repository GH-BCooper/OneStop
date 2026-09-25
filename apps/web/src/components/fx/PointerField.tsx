"use client";

// A living backdrop: a field of drifting points that the mouse pushes, pulls and lights up, with
// thin lines joining neighbours. It also drives the spotlight on cards (`.os-glow` gets its
// `--mx/--my` here), so one pointer listener serves the whole app.
//
// Cheap on purpose: ~60-90 points, DPR capped at 1.5, one rAF loop that stops when the tab is
// hidden, nothing at all for visitors who ask for reduced motion.
import { useEffect, useRef } from "react";

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

export function PointerField() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let dots: Dot[] = [];
    const mouse = { x: -9999, y: -9999, active: false };
    let raf = 0;
    let running = false;

    const rgb = () =>
      document.documentElement.dataset.theme === "dark" ? "196,210,228" : "30,42,56";

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = window.innerWidth;
      h = window.innerHeight;
      el.width = Math.floor(w * dpr);
      el.height = Math.floor(h * dpr);
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(90, Math.max(28, Math.floor((w * h) / 22000)));
      dots = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: Math.random() * 1.4 + 0.6,
      }));
    };

    const LINK = 120;
    const REACH = 170;

    const frame = () => {
      ctx.clearRect(0, 0, w, h);
      const c = rgb();
      for (const d of dots) {
        if (mouse.active) {
          const dx = d.x - mouse.x;
          const dy = d.y - mouse.y;
          const dist = Math.hypot(dx, dy);
          if (dist < REACH && dist > 0.1) {
            // Nearby points swirl gently away, then ease back: the field feels the cursor.
            const push = (1 - dist / REACH) * 0.9;
            d.vx += (dx / dist) * push * 0.12;
            d.vy += (dy / dist) * push * 0.12;
          }
        }
        d.vx *= 0.985;
        d.vy *= 0.985;
        d.x += d.vx + 0.02;
        d.y += d.vy;
        if (d.x < -10) d.x = w + 10;
        else if (d.x > w + 10) d.x = -10;
        if (d.y < -10) d.y = h + 10;
        else if (d.y > h + 10) d.y = -10;
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < dots.length; i += 1) {
        const a = dots[i]!;
        for (let j = i + 1; j < dots.length; j += 1) {
          const b = dots[j]!;
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist < LINK) {
            ctx.strokeStyle = `rgba(${c},${(1 - dist / LINK) * 0.22})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        if (mouse.active) {
          const dist = Math.hypot(a.x - mouse.x, a.y - mouse.y);
          if (dist < REACH) {
            ctx.strokeStyle = `rgba(${c},${(1 - dist / REACH) * 0.55})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.stroke();
          }
        }
        ctx.fillStyle = `rgba(${c},0.55)`;
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (mouse.active) {
        const g = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 220);
        g.addColorStop(0, `rgba(${c},0.10)`);
        g.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(mouse.x - 220, mouse.y - 220, 440, 440);
      }
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running || reduce || document.hidden) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    // Spotlight on cards: write the pointer position (relative to the card) into CSS vars.
    const onMove = (e: PointerEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
      const target = (e.target as Element | null)?.closest?.<HTMLElement>(".os-glow") ?? null;
      if (target) {
        const box = target.getBoundingClientRect();
        target.style.setProperty("--mx", `${e.clientX - box.left}px`);
        target.style.setProperty("--my", `${e.clientY - box.top}px`);
      }
    };
    const onLeave = () => {
      mouse.active = false;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    resize();
    start();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 opacity-90"
    />
  );
}
