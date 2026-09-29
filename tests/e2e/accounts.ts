// Helpers for the end-to-end files that need a signed-in user.
//
// Sign-up now sends a 6-digit code by email, and a production build will not "send" it to a console
// nobody reads, so most tests skip the sign-up ceremony: the user is written straight into the
// test schema (with a real bcrypt hash, exactly as sign-up would store it) and signs in through the
// real login form. The one test that is *about* sign-up drives the whole flow and reads the code
// back from the server's log.
import bcrypt from "bcryptjs";
import type { Page } from "playwright-core";
import type { PrismaClient } from "../../apps/api/src/db/client.ts";

/** A verified account, as if it had signed up. */
export async function seedUser(
  prisma: PrismaClient,
  { email, password, name = "E2E Tester" }: { email: string; password: string; name?: string },
): Promise<{ id: string }> {
  return prisma.user.create({
    data: {
      email,
      name,
      emailVerified: new Date(),
      passwordHash: await bcrypt.hash(password, 4),
    },
    select: { id: true },
  });
}

/** Signs in through the real form and waits until the app has moved on from the auth pages. */
export async function signInAs(
  page: Page,
  baseUrl: string,
  email: string,
  password: string,
): Promise<void> {
  await page.goto(`${baseUrl}/auth/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 30_000 });
}

/** The newest 6-digit sign-up code in a chunk of the server's console output. */
export function latestVerificationCode(consoleOutput: string): string | undefined {
  const codes = [...consoleOutput.matchAll(/(\d{6}) is your OneStop verification code/g)];
  return codes.at(-1)?.[1];
}
