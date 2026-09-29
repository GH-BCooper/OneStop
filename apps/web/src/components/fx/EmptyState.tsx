// Empty, error and offline states with an illustration (21-roadmap-expansion.md, roadmap §7.10).
//
// One inline-SVG line drawing per state, in the app's own polished-metal language: a single stroke
// colour taken from the theme tokens, a faint gradient sheen, nothing filled. Drawn once here and
// reused everywhere, so it costs no image hosting, no stock-art licence and no extra request — and
// it inherits every theme preset for free because the colours are `currentColor` and CSS variables.
import type { ReactNode } from "react";

export type EmptyStateKind =
  | "no-history"
  | "no-results"
  | "no-workflows"
  | "no-favorites"
  | "offline"
  | "error"
  | "no-notifications"
  | "empty-folder";

/**
 * Each drawing is deliberately simple: one recognisable object, a hint of the app's diagonal sheen,
 * and nothing that needs a second colour to read.
 */
function Art({ kind }: { kind: EmptyStateKind }) {
  const common = {
    width: 120,
    height: 96,
    viewBox: "0 0 120 96",
    role: "img" as const,
    "aria-hidden": true,
    className: "text-fg-muted/70",
  };
  switch (kind) {
    case "no-history":
      return (
        <svg {...common}>
          <g stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="60" cy="48" r="28" />
            <path d="M60 32v17l12 8" />
            <path d="M24 30a40 40 0 0 1 8-9M96 30a40 40 0 0 0-8-9" opacity="0.45" />
          </g>
          <path d="M34 22 108 78" stroke="url(#os-sheen)" strokeWidth="10" opacity="0.18" />
          <defs>
            <linearGradient id="os-sheen" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
              <stop offset="50%" stopColor="currentColor" stopOpacity="0.9" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      );
    case "no-results":
      return (
        <svg {...common}>
          <g stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="52" cy="42" r="22" />
            <path d="M68 58 90 78" />
            <path d="M44 42h16" opacity="0.5" />
          </g>
        </svg>
      );
    case "no-workflows":
      return (
        <svg {...common}>
          <g stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <rect x="12" y="34" width="26" height="26" rx="5" />
            <rect x="47" y="34" width="26" height="26" rx="5" />
            <rect x="82" y="34" width="26" height="26" rx="5" strokeDasharray="4 4" />
            <path d="M38 47h9M73 47h9" />
          </g>
        </svg>
      );
    case "no-favorites":
      return (
        <svg {...common}>
          <g stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M60 24l9 18 20 3-14.5 14 3.5 20L60 70l-18 9 3.5-20L31 45l20-3z" />
          </g>
        </svg>
      );
    case "offline":
      return (
        <svg {...common}>
          <g stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M28 54a34 34 0 0 1 64 0" opacity="0.4" />
            <path d="M40 64a22 22 0 0 1 40 0" opacity="0.65" />
            <circle cx="60" cy="74" r="3" />
            <path d="M24 22 96 78" strokeWidth="2.2" />
          </g>
        </svg>
      );
    case "error":
      return (
        <svg {...common}>
          <g stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M60 20 98 76H22z" />
            <path d="M60 40v18" />
            <circle cx="60" cy="66" r="1.6" />
          </g>
        </svg>
      );
    case "no-notifications":
      return (
        <svg {...common}>
          <g stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M46 62V44a14 14 0 0 1 28 0v18l6 8H40z" />
            <path d="M54 74a6 6 0 0 0 12 0" />
          </g>
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <g stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 70V30a4 4 0 0 1 4-4h20l7 9h29a4 4 0 0 1 4 4v31a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4z" />
            <path d="M30 50h44" strokeDasharray="4 5" opacity="0.55" />
          </g>
        </svg>
      );
  }
}

export interface EmptyStateProps {
  kind: EmptyStateKind;
  title: string;
  /** One or two sentences that say what to do next, not just that something is missing. */
  description?: string;
  /** A primary action: usually a Link or Button. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ kind, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-border/70 bg-surface/40 px-6 py-10 text-center ${className ?? ""}`}
      data-empty-state={kind}
    >
      <Art kind={kind} />
      <p className="text-base font-medium">{title}</p>
      {description && <p className="max-w-prose text-sm text-fg-muted">{description}</p>}
      {action}
    </div>
  );
}
