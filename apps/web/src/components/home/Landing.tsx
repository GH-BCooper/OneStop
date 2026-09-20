// The marketing home page shown to a signed-out visitor (item 13 of the redesign). It sells the
// app and gets a visitor to "Get Started" — it does not itself run any tool, which is what keeps
// the guest-facing shell this simple. A returning, signed-in visitor never sees this: they get the
// Dashboard (`Dashboard.tsx`) instead.
import { GROUPS, toolsForCatalogPage } from "@onestop/tool-registry";
import { buttonClasses, Card, CardDescription, CardTitle } from "@onestop/ui";
import Image from "next/image";
import Link from "next/link";

const STEPS = [
  {
    title: "Choose",
    body: "Browse All Tools by category, search for what you need, or describe the task to the AI Assistant.",
  },
  {
    title: "Use",
    body: "Drop in a file or paste a link, pick the options that matter, and run it.",
  },
  {
    title: "Done",
    body: "Download the result. Uploads and outputs are deleted automatically — nothing lingers.",
  },
];

export function Landing() {
  return (
    <div className="flex flex-col gap-20 pb-8">
      <section className="flex flex-col items-center gap-6 pt-8 text-center">
        <Image src="/images/Logo.png" alt="OneStop" width={72} height={72} className="rounded-2xl" priority />
        <h1 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">
          Every file. Every format. <span className="brand-gradient">One stop.</span>
        </h1>
        <p className="max-w-2xl text-fg-muted">
          OneStop converts, edits and inspects PDFs, images, documents, spreadsheets, audio, video,
          QR codes and more — free and local-first. Sign in only if you want your history,
          favourites and workflows to follow you; every tool works either way.
        </p>
        <Link href="/auth/signup" className={buttonClasses("primary", "lg")}>
          Get Started
        </Link>
      </section>

      <section aria-labelledby="features-heading" className="flex flex-col gap-6">
        <h2 id="features-heading" className="text-center text-2xl font-semibold">
          Everything in one place
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {GROUPS.map((c) => (
            <li key={c.id}>
              <Link
                href={`/tools/${c.id}`}
                className="block h-full rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Card interactive className="flex h-full items-center gap-3">
                  <span aria-hidden="true" className="text-2xl">
                    {c.icon}
                  </span>
                  <div className="min-w-0">
                    <CardTitle>{c.name}</CardTitle>
                    <CardDescription>{toolsForCatalogPage(c.id).length} tools</CardDescription>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="how-heading" className="flex flex-col gap-6">
        <h2 id="how-heading" className="text-center text-2xl font-semibold">
          How it works
        </h2>
        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <Card className="flex h-full flex-col gap-2">
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-fg"
                >
                  {i + 1}
                </span>
                <CardTitle>{step.title}</CardTitle>
                <CardDescription>{step.body}</CardDescription>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface-muted p-10 text-center">
        <h2 className="text-2xl font-semibold">Ready to get started?</h2>
        <p className="max-w-xl text-fg-muted">
          Create a free account for saved history and favourites, or jump straight into any tool as
          a guest.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/auth/signup" className={buttonClasses("primary", "lg")}>
            Get Started
          </Link>
          <Link href="/tools" className={buttonClasses("secondary", "lg")}>
            Browse tools as a guest
          </Link>
        </div>
      </section>
    </div>
  );
}
