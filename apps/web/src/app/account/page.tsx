import type { Metadata } from "next";
import { PagePlaceholder } from "@/components/PagePlaceholder";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage() {
  return (
    <PagePlaceholder
      title="Account"
      description="Your profile, sign-in methods and saved data."
      phase="13-auth-database.md"
    />
  );
}
