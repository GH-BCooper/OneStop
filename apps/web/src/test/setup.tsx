// Global test setup: mocks the Next.js router for component tests (harmless in node tests).
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

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
  navigation.push.mockReset();
  navigation.searchParams = new URLSearchParams();
  if (typeof document === "undefined") return;
  cleanup();
  navigation.pathname = "/";
  document.documentElement.removeAttribute("data-theme");
  localStorage.clear();
});
