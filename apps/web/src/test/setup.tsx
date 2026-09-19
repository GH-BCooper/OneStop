// Global test setup: mocks the Next.js router and the Auth.js session for component tests
// (harmless in node tests).
import { cleanup, configure } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, vi } from "vitest";
import { resetConnectivityMonitor } from "@/lib/use-connectivity";

/**
 * The session every component test sees (14-history-favorites.md). Favourites, history and
 * settings all read `useSession`, so the mock lives here rather than in each suite; a test that
 * needs a signed-in visitor sets `session.data` before rendering.
 */
export const session = {
  data: null as { user: { id: string; email: string; name: string | null } } | null,
  status: "unauthenticated" as "authenticated" | "unauthenticated" | "loading",
};

// `findBy*`/`waitFor` default to one second. The phase-14 screens wait on an IndexedDB read or a
// mocked fetch, which is instant on an idle machine and can be several times that when every test
// file is running at once, so the budget is raised rather than sprinkled per call.
configure({ asyncUtilTimeout: 5000 });

export const signInMock = vi.fn();
export const signOutMock = vi.fn();

vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
  signOut: (...args: unknown[]) => signOutMock(...args),
  useSession: () => ({ data: session.data, status: session.status }),
  SessionProvider: ({ children }: { children: ReactNode }) => children,
}));

export const navigation = {
  pathname: "/",
  push: vi.fn(),
  /** Query string the auth pages read (13-auth-database.md): the reset token, the ?next= target. */
  searchParams: new URLSearchParams(),
};

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => navigation.searchParams,
  redirect: (url: string) => {
    navigation.push(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  useRouter: () => ({
    push: navigation.push,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

afterEach(() => {
  // The connectivity monitor is one shared store for the whole app (18-pwa-offline.md), so a test
  // that leaves it in the offline state would block the next one's tool page.
  resetConnectivityMonitor();
  session.data = null;
  session.status = "unauthenticated";
  signInMock.mockReset();
  signOutMock.mockReset();
  navigation.push.mockReset();
  navigation.searchParams = new URLSearchParams();
  if (typeof document === "undefined") return;
  cleanup();
  navigation.pathname = "/";
  document.documentElement.removeAttribute("data-theme");
  localStorage.clear();
});
