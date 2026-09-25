"use client";

// The hero's 3D centrepiece: a glassy cube ringed by the tool categories, orbiting in real CSS
// 3D. It turns by itself and leans toward the mouse (smoothed), so moving the cursor around the
// hero tilts the whole scene. Pure transforms - no WebGL, no library, no layout work per frame.
import { useEffect, useRef } from "react";

export interface OrbitItem {
  icon: string;
  name: string;
}

const FACES = [
  "translateZ(56px)",
  "rotateY(180deg) translateZ(56px)",
  "rotateY(90deg) translateZ(56px)",
  "rotateY(-90deg) translateZ(56px)",
  "rotateX(90deg) translateZ(56px)",
  "rotateX(-90deg) translateZ(56px)",
];

export function ToolOrbit({ items }: { items: OrbitItem[] }) {
  const scene = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const cube = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = scene.current;
    if (!root) return;
    const reduce =
      typeof window.matchMedia !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target = { x: -12, y: 0 };
    const cur = { x: -12, y: 0 };
    let spin = 0;
    let raf = 0;
    let visible = true;

    const onMove = (e: PointerEvent) => {
      const box = root.getBoundingClientRect();
      const nx = (e.clientX - (box.left + box.width / 2)) / Math.max(window.innerWidth / 2, 1);
      const ny = (e.clientY - (box.top + box.height / 2)) / Math.max(window.innerHeight / 2, 1);
      target.y = Math.max(-1, Math.min(1, nx)) * 28;
      target.x = -12 - Math.max(-1, Math.min(1, ny)) * 22;
    };
    const frame = () => {
      cur.x += (target.x - cur.x) * 0.08;
      cur.y += (target.y - cur.y) * 0.08;
      spin += 0.22;
      root.style.transform = `rotateX(${cur.x}deg) rotateY(${cur.y}deg)`;
      if (ring.current) ring.current.style.transform = `rotateY(${spin}deg)`;
      if (cube.current) {
        cube.current.style.transform = `rotateX(${spin * 1.3}deg) rotateY(${-spin * 1.7}deg)`;
      }
      if (visible && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const io =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(([entry]) => {
            visible = Boolean(entry?.isIntersecting);
            if (visible && !document.hidden && !reduce) {
              cancelAnimationFrame(raf);
              raf = requestAnimationFrame(frame);
            }
          })
        : null;
    io?.observe(root);
    if (!reduce) {
      window.addEventListener("pointermove", onMove, { passive: true });
      raf = requestAnimationFrame(frame);
    } else {
      root.style.transform = "rotateX(-12deg) rotateY(18deg)";
    }
    return () => {
      io?.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  const radius = 190;

  return (
    <div className="os-orbit-stage" aria-hidden="true">
      <div ref={scene} className="os-orbit-scene">
        <div ref={cube} className="os-cube">
          {FACES.map((t, i) => (
            <div key={i} className="os-cube-face" style={{ transform: t }}>
              1
            </div>
          ))}
        </div>
        <div ref={ring} className="os-orbit-ring">
          {items.map((item, i) => (
            <div
              key={item.name}
              className="os-orbit-card"
              style={{
                transform: `rotateY(${(360 / items.length) * i}deg) translateZ(${radius}px)`,
              }}
            >
              <span className="text-2xl">{item.icon}</span>
              <span className="text-[10px] font-medium leading-tight">
                {item.name.split(",")[0]}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="os-orbit-floor" />
    </div>
  );
}
