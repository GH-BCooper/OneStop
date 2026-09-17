import Link from "next/link";

const links = [
  { label: "Settings", href: "/settings" },
  { label: "Status", href: "/status" },
  { label: "Sign in", href: "/auth/login" },
];

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between">
        <p>OneStop · free, local-first tools. Files stay on your device where possible.</p>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-4">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="hover:text-fg hover:underline">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
