import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Create an account" };

export default function Page() {
  return <SignupForm />;
}
