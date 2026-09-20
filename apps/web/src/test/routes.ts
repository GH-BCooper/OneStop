// Every route from master plan §3.1, with sample params for dynamic segments.
export interface RouteCase {
  path: string;
  load: () => Promise<{ default: (props: never) => unknown }>;
  params?: Record<string, string>;
  heading: RegExp;
}

export const routeCases: RouteCase[] = [
  // "/" renders the signed-out marketing Landing page or the personalized Dashboard - which one
  // depends on whether accounts are configured and (for this generic smoke test) the default
  // unauthenticated session mock, so the heading matches either. shell.test.tsx's own "home page"
  // tests cover both variants explicitly by toggling the mocked session.
  {
    path: "/",
    load: () => import("@/app/page"),
    heading: /onestop|good (morning|afternoon|evening)/i,
  },
  { path: "/assistant", load: () => import("@/app/assistant/page"), heading: /ai assistant/i },
  { path: "/tools", load: () => import("@/app/tools/page"), heading: /all tools/i },
  {
    path: "/tools/pdf",
    load: () => import("@/app/tools/[category]/page"),
    params: { category: "pdf" },
    heading: /pdf tools/i,
  },
  {
    path: "/tools/pdf/merge-pdf",
    load: () => import("@/app/tools/[category]/[slug]/page"),
    params: { category: "pdf", slug: "merge-pdf" },
    heading: /merge pdf/i,
  },
  { path: "/workflows", load: () => import("@/app/workflows/page"), heading: /^workflows$/i },
  {
    path: "/workflows/new",
    load: () => import("@/app/workflows/new/page"),
    heading: /new workflow/i,
  },
  {
    path: "/workflows/demo-1",
    load: () => import("@/app/workflows/[id]/page"),
    params: { id: "demo-1" },
    heading: /^workflow$/i,
  },
  { path: "/history", load: () => import("@/app/history/page"), heading: /history/i },
  { path: "/account", load: () => import("@/app/account/page"), heading: /account/i },
  { path: "/settings", load: () => import("@/app/settings/page"), heading: /settings/i },
  { path: "/auth/login", load: () => import("@/app/auth/login/page"), heading: /sign in/i },
  {
    path: "/auth/signup",
    load: () => import("@/app/auth/signup/page"),
    heading: /create an account/i,
  },
  {
    path: "/auth/reset-password",
    load: () => import("@/app/auth/reset-password/page"),
    heading: /reset your password/i,
  },
  { path: "/status", load: () => import("@/app/status/page"), heading: /status/i },
];
