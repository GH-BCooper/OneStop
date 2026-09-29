import { describe, expect, it } from "vitest";
import { isGuestOnlyPath, isPublicPath } from "@/proxy";

describe("route gate", () => {
  it("leaves the landing page, catalogue and auth pages open to guests", () => {
    for (const p of [
      "/",
      "/tools",
      "/tools/pdf",
      "/tools/pdf/merge-pdf",
      "/auth/login",
      "/q/abc",
      "/offline",
    ]) {
      expect(isPublicPath(p)).toBe(true);
    }
  });

  it("leaves shared-result links open: their recipients have no account by design", () => {
    expect(isPublicPath("/s/XEpdkFN-7nDyoSscsZhsgIitJMI")).toBe(true);
    // ...without opening up anything that merely starts with the same letter.
    expect(isPublicPath("/settings")).toBe(false);
    expect(isPublicPath("/status")).toBe(false);
  });

  it("keeps everything else behind sign-in", () => {
    for (const p of [
      "/assistant",
      "/assistant/abc",
      "/workflows",
      "/history",
      "/settings",
      "/account",
      "/status",
      "/toolsfoo",
    ]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });

  it("keeps signed-in visitors off sign-in and sign-up only", () => {
    expect(isGuestOnlyPath("/auth/login")).toBe(true);
    expect(isGuestOnlyPath("/auth/signup")).toBe(true);
    expect(isGuestOnlyPath("/auth/reset-password")).toBe(false);
    expect(isGuestOnlyPath("/tools")).toBe(false);
  });
});
