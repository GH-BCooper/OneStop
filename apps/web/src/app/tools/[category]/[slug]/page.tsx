import { getCategory, getToolByRoute, inputKind, tools, typeLabel } from "@onestop/tool-registry";
import { buttonClasses, Card } from "@onestop/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth, authIsConfigured } from "@/auth";
import { ToolBadges } from "@/components/tools/ToolBadges";
import { ToolNotices } from "@/components/tools/ToolNotices";
import { ToolPage } from "@/components/tools/ToolPage";
import { DynamicQRManager } from "@/components/qr/DynamicQRManager";
import { QRScanner } from "@/components/qr/QRScanner";

/** Tools whose codes are managed from a list under the form (11-qr-tools.md). */
const DYNAMIC_QR_TOOLS = new Set(["dynamic-qr-code", "custom-qr-landing-page", "qr-content-page"]);

interface Props {
  params: Promise<{ category: string; slug: string }>;
}

export function generateStaticParams() {
  return tools.map((t) => ({ category: t.category, slug: t.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category, slug } = await params;
  const tool = getToolByRoute(category, slug);
  return tool ? { title: tool.name, description: tool.description } : { title: "Tool" };
}

export default async function ToolRoute({ params }: Props) {
  const { category, slug } = await params;
  const tool = getToolByRoute(category, slug);
  if (!tool) notFound();
  const categoryName = getCategory(tool.category)?.name ?? tool.category;
  const kind = inputKind(tool);

  // Anyone can browse the catalogue, but actually using a tool needs an account (owner's product
  // decision). When this instance has no accounts configured at all, nobody could ever sign in,
  // so the gate would just lock the app — skip it, mirroring the home page's same fallback.
  let signedIn = true;
  if (tool.id !== "ai-assistant" && authIsConfigured()) {
    signedIn = false;
    try {
      const session = await auth();
      signedIn = Boolean(session?.user);
    } catch (err) {
      console.error("[tool-route] could not read the session", err);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
          <Link href="/tools" className="hover:text-primary hover:underline">
            All Tools
          </Link>{" "}
          <span aria-hidden="true">/</span>{" "}
          <Link href={`/tools/${tool.category}`} className="hover:text-primary hover:underline">
            {categoryName}
          </Link>{" "}
          <span aria-hidden="true">/</span> {tool.name}
        </nav>
        <h1 className="text-2xl font-bold sm:text-3xl">{tool.name}</h1>
        <p className="text-fg-muted">{tool.description}</p>
        <p className="text-sm text-fg-muted">
          {kind === "none" ? "No input" : typeLabel(tool.inputTypes)}{" "}
          <span aria-hidden="true">→</span> {typeLabel(tool.outputTypes)}
        </p>
        <ToolBadges tool={tool} />
      </div>

      {tool.id === "ai-assistant" ? (
        <div className="flex flex-col items-start gap-3">
          <p>
            The assistant has its own full-screen workspace, where it can chain several tools in one
            request.
          </p>
          <Link href="/assistant" className={buttonClasses("primary", "lg")}>
            <span aria-hidden="true">✨</span> Open the AI Assistant
          </Link>
        </div>
      ) : !signedIn ? (
        <Card className="flex flex-col items-start gap-3 border-warning">
          <h2 className="text-lg font-semibold">Sign in required</h2>
          <p className="text-sm text-fg-muted">
            You can browse every tool for free, but running {tool.name} needs an account. It only
            takes a moment, and it&rsquo;s free.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/auth/signup?next=/tools/${tool.category}/${tool.slug}`}
              className={buttonClasses("primary")}
            >
              Sign up
            </Link>
            <Link
              href={`/auth/login?next=/tools/${tool.category}/${tool.slug}`}
              className={buttonClasses("secondary")}
            >
              Sign in
            </Link>
          </div>
        </Card>
      ) : (
        <>
          {/* Camera scanning happens entirely in the browser, so it sits beside the upload form
              rather than inside the pipeline (11-qr-tools.md). */}
          {tool.id === "qr-code-scanner" && <QRScanner />}
          {/* 17-online-media-network-tools.md: the legal notice must be visible on the Online
              Media pages, above the form rather than under the result. */}
          <ToolNotices toolId={tool.id} />
          <ToolPage tool={tool} />
          {DYNAMIC_QR_TOOLS.has(tool.id) && <DynamicQRManager />}
          {tool.id === "qr-code-analytics" && <DynamicQRManager mode="analytics" />}
        </>
      )}
    </div>
  );
}
