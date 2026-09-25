// The marketing home page shown to a signed-out visitor (item 13 of the redesign). It sells the
// app and gets a visitor to "Get Started" — it does not itself run any tool, which is what keeps
// the guest-facing shell this simple. A returning, signed-in visitor never sees this: they get the
// Dashboard (`Dashboard.tsx`) instead.
import { GROUPS, toolsForCatalogPage } from "@onestop/tool-registry";
import { buttonClasses, Card, CardDescription, CardTitle } from "@onestop/ui";
import Image from "next/image";
import { ToolOrbit } from "@/components/fx/ToolOrbit";
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

const HIGHLIGHTS = [
  { label: "Every category, one app", detail: "PDFs, images, documents, spreadsheets, audio, video, QR and more." },
  { label: "$0 required", detail: "No mandatory paid API, subscription or account — every core feature is free." },
  { label: "Local-first", detail: "Files are processed on the server that runs OneStop and deleted right after." },
];

export function Landing() {
  const toolCount = GROUPS.reduce((sum, c) => sum + toolsForCatalogPage(c.id).length, 0);
  return (
    <div className="flex flex-col gap-20 pb-8">
      <section className="relative grid items-center gap-6 pt-4 lg:grid-cols-[1.15fr_1fr]">
        <div className="os-aurora" aria-hidden="true" />
        <div className="flex flex-col items-center gap-6 text-center lg:items-start lg:text-left">
        <Image
          src="/images/Logo.png"
          alt="OneStop"
          width={88}
          height={88}
          className="os-enter rounded-2xl"
          priority
        />
        <h1 className="os-enter os-enter-1 max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
          <span className="brand-gradient">OneStop</span>—Everything, Everywhere, All at once!
        </h1>
        <p className="os-enter os-enter-2 max-w-2xl text-lg text-fg-muted">
          OneStop converts, edits and inspects PDFs, images, documents, spreadsheets, audio, video,
          QR codes and more — free and local-first. Sign in to run tools, keep history, favourites
          and workflows, and pick up right where you left off on any device.
        </p>
        <div className="os-enter os-enter-3 flex flex-wrap items-center justify-center gap-3 text-lg lg:justify-start">
          <Link href="/auth/signup" className={`${buttonClasses("primary", "lg")} os-btn-lift`}>
            Get Started
          </Link>
          <span className="text-fg-muted">
            Already have an account?{" "}
            <Link href="/auth/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </span>
        </div>
        </div>
        <div className="os-enter os-enter-2 flex justify-center">
          <ToolOrbit items={GROUPS.map((g) => ({ icon: g.icon, name: g.name }))} />
        </div>
      </section>

      <dl className="os-enter os-enter-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {HIGHLIGHTS.map((h) => (
          <Card key={h.label} className="text-center">
            <dt className="text-base font-semibold">{h.label}</dt>
            <dd className="text-sm text-fg-muted">{h.detail}</dd>
          </Card>
        ))}
      </dl>

      <section aria-labelledby="features-heading" className="flex flex-col gap-6">
        <h2 id="features-heading" className="text-center text-2xl font-semibold sm:text-3xl">
          Everything in one place
        </h2>
        <p className="mx-auto max-w-2xl text-center text-base text-fg-muted">
          {toolCount}+ tools across {GROUPS.length} categories — browse the whole catalogue any
          time, no account needed.
        </p>
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
          <li>
            <Link
              href="/tools"
              className="block h-full rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Card interactive className="flex h-full items-center gap-3 border-primary/40">
                <span aria-hidden="true" className="text-2xl">
                  🧰
                </span>
                <div className="min-w-0">
                  <CardTitle>Browse All Tools</CardTitle>
                  <CardDescription>Every tool, searchable in one catalogue</CardDescription>
                </div>
              </Card>
            </Link>
          </li>
        </ul>
      </section>

      <section aria-labelledby="how-heading" className="flex flex-col gap-6">
        <h2 id="how-heading" className="text-center text-2xl font-semibold sm:text-3xl">
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
        <h2 className="text-2xl font-semibold sm:text-3xl">Ready to get started?</h2>
        <p className="max-w-xl text-lg text-fg-muted">
          Create a free account to run tools, save history and favourites, and build workflows.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 text-lg">
          <Link href="/auth/signup" className={buttonClasses("primary", "lg")}>
            Get Started
          </Link>
          <span className="text-fg-muted">
            Already have an account?{" "}
            <Link href="/auth/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </span>
        </div>
      </section>
    </div>
  );
}
