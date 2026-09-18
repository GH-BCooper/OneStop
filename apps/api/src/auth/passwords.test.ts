import { describe, expect, it } from "vitest";
import {
  hashPassword,
  isBcryptHash,
  PASSWORD_MAX_LENGTH,
  validatePasswordStrength,
  verifyPassword,
} from "./passwords.ts";

describe("password hashing", () => {
  it("stores a bcrypt hash, never the password", async () => {
    const password = "correct horse battery staple";
    const hash = await hashPassword(password);
    expect(hash).not.toBe(password);
    expect(hash).not.toContain(password);
    expect(isBcryptHash(hash)).toBe(true);
    expect(hash.startsWith("$2")).toBe(true);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const [a, b] = await Promise.all([
      hashPassword("hunter2hunter2"),
      hashPassword("hunter2hunter2"),
    ]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("hunter2hunter2", a)).toBe(true);
    expect(await verifyPassword("hunter2hunter2", b)).toBe(true);
  });

  it("accepts the right password and rejects anything else", async () => {
    const hash = await hashPassword("a-good-password");
    expect(await verifyPassword("a-good-password", hash)).toBe(true);
    expect(await verifyPassword("a-good-passworD", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
    expect(await verifyPassword("a-good-password", null)).toBe(false);
  });

  it("refuses passwords that are too short or longer than bcrypt reads", async () => {
    expect(validatePasswordStrength("short")).toMatch(/at least 8/);
    expect(validatePasswordStrength("x".repeat(PASSWORD_MAX_LENGTH + 1))).toMatch(/at most/);
    expect(validatePasswordStrength("just-long-enough")).toBeUndefined();
    await expect(hashPassword("short")).rejects.toThrow(/at least 8/);
  });

  it("does not mistake a plain string for a hash", () => {
    expect(isBcryptHash("password123")).toBe(false);
    expect(isBcryptHash("$2b$12$short")).toBe(false);
  });
});
