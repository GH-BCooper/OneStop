// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoginForm, ResetPasswordForm, SignupForm } from "@/components/auth/forms";
import { validateEmail, validateLogin, validatePassword, validateSignup } from "@/lib/validation";

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
  });
});

describe("auth forms", () => {
  it("login shows errors on empty submit and never calls a backend", () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your email address.")).toBeTruthy();
    expect(screen.getByText("Enter your password.")).toBeTruthy();
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("login acknowledges a valid submit", () => {
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "me@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("status").textContent).toMatch(/nothing was sent/i);
  });

  it("signup catches mismatched passwords", () => {
    render(<SignupForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sam" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "sam@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password1" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "password2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("Passwords don't match.")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("reset password validates email", () => {
    render(<ResetPasswordForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
  });
});
