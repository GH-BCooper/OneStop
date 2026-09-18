// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm, ResetPasswordForm, SignupForm } from "@/components/auth/forms";
import {
  validateEmail,
  validateLogin,
  validateNewPassword,
  validatePassword,
  validatePasswordChange,
  validateSignup,
} from "@/lib/validation";
import { navigation } from "./setup";

const signIn = vi.fn();
vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signIn(...args),
  signOut: vi.fn(),
  useSession: () => ({ data: null, status: "unauthenticated" }),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const search = { params: new URLSearchParams() };
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("next/navigation");
  return {
    ...actual,
    useSearchParams: () => search.params,
    usePathname: () => "/",
    useRouter: () => ({
      push: navigation.push,
      replace: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
    }),
  };
});

const fetchMock = vi.fn();

beforeEach(() => {
  search.params = new URLSearchParams();
  signIn.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("validation", () => {
  it.each([
    ["", "Enter your email address."],
    ["nope", "Enter a valid email address."],
    ["a@b", "Enter a valid email address."],
    ["a@b.co", undefined],
    ["  a@b.co  ", undefined],
  ])("validateEmail(%j)", (input, expected) => {
    expect(validateEmail(input)).toBe(expected);
  });

  it("requires 8+ character passwords", () => {
    expect(validatePassword("")).toBeDefined();
    expect(validatePassword("1234567")).toBeDefined();
    expect(validatePassword("12345678")).toBeUndefined();
  });

  it("returns only failing fields", () => {
    expect(validateLogin({ email: "a@b.co", password: "x" })).toEqual({});
    expect(
      Object.keys(
        validateSignup({ name: " ", email: "a@b.co", password: "longenough", confirm: "x" }),
      ),
    ).toEqual(["name", "confirm"]);
    expect(validateNewPassword({ password: "longenough", confirm: "longenough" })).toEqual({});
    expect(
      Object.keys(
        validatePasswordChange({ currentPassword: "", newPassword: "short", confirm: "other" }),
      ),
    ).toEqual(["currentPassword", "newPassword", "confirm"]);
  });
});

describe("login form", () => {
  it("shows errors on empty submit and never calls the backend", () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your email address.")).toBeTruthy();
    expect(screen.getByText("Enter your password.")).toBeTruthy();
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe("true");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("signs in and goes to the account page", async () => {
    signIn.mockResolvedValue({ ok: true, error: null });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "me@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-good-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/account"));
    expect(signIn).toHaveBeenCalledWith("credentials", {
      email: "me@example.com",
      password: "a-good-password",
      redirect: false,
    });
  });

  it("returns to where the visitor came from", async () => {
    search.params = new URLSearchParams("next=/workflows");
    signIn.mockResolvedValue({ ok: true, error: null });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "me@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-good-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/workflows"));
  });

  it("shows one short message for wrong credentials", async () => {
    signIn.mockResolvedValue({ ok: false, error: "CredentialsSignin" });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "me@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("That email or password is incorrect."),
    );
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("hides Google until it is configured, and says so when accounts are off", async () => {
    const { unmount } = render(<LoginForm />);
    expect(screen.queryByRole("button", { name: /google/i })).toBeNull();
    unmount();

    const configured = render(<LoginForm googleEnabled />);
    expect(screen.getByRole("button", { name: /google/i })).toBeTruthy();
    configured.unmount();

    // No database means no sign-in at all - and no button that could not work.
    render(<LoginForm googleEnabled available={false} />);
    expect(screen.queryByRole("button", { name: /google/i })).toBeNull();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "me@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-good-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/unavailable/i));
    expect(signIn).not.toHaveBeenCalled();
  });
});

describe("signup form", () => {
  it("catches mismatched passwords before calling the server", () => {
    render(<SignupForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sam" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password1" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "password2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("Passwords don't match.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates the account, signs in, and never sends the password anywhere else", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, user: { id: "u1" } }, 201));
    signIn.mockResolvedValue({ ok: true, error: null });
    render(<SignupForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sam" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-good-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "a-good-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/account"));
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/signup");
    expect(JSON.parse(String(init.body))).toEqual({
      name: "Sam",
      email: "sam@example.com",
      password: "a-good-password",
    });
  });

  it("puts a server-side field error on the right field", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          error: {
            code: "EMAIL_TAKEN",
            message: "That email already has an account.",
            field: "email",
          },
        },
        409,
      ),
    );
    render(<SignupForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sam" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-good-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "a-good-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() =>
      expect(screen.getByText("That email already has an account.")).toBeTruthy(),
    );
    expect(signIn).not.toHaveBeenCalled();
  });
});

describe("reset password form", () => {
  it("validates the email before asking for a link", () => {
    render(<ResetPasswordForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the neutral answer and mentions the console when no mail provider is set", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        message: "If that email has an account, a reset link is on its way.",
        transport: "console",
      }),
    );
    render(<ResetPasswordForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/on its way/i));
    expect(screen.getByRole("status").textContent).toMatch(/server console/i);
  });

  it("checks the token from the link and saves a new password", async () => {
    search.params = new URLSearchParams("token=abc123");
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, valid: true }))
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, message: "Your password has been changed." }),
      );
    render(<ResetPasswordForm />);
    await waitFor(() => expect(screen.getByLabelText("New password")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "a-brand-new-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "a-brand-new-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save new password" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/has been changed/i),
    );
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/auth/reset/confirm");
    expect(JSON.parse(String(init.body))).toEqual({
      token: "abc123",
      password: "a-brand-new-password",
    });
  });

  it("explains an expired link and offers to send another", async () => {
    search.params = new URLSearchParams("token=expired");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        valid: false,
        reason: "That reset link has expired. Request a new one.",
      }),
    );
    render(<ResetPasswordForm />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/expired/i));
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeTruthy();
  });
});
