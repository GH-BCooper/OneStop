import { themeCss, themeInitScript } from "@onestop/ui";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { authIsConfigured } from "@/lib/auth-config";
import { SessionProvider } from "@/components/auth/SessionProvider";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { OfflineBanner } from "@/components/layout/OfflineBanner";
import { ServiceWorkerManager } from "@/components/pwa/ServiceWorkerManager";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "OneStop", template: "%s · OneStop" },
  description: "All your file, PDF, image, data, media and developer tools in one place.",
  // Installability (18-pwa-offline.md): the manifest, the icon set and the iOS-only hints Safari
  // reads instead of the manifest.
  applicationName: "OneStop",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "OneStop", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Matches manifest.json, so the installed app's chrome is the app's own colour.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1120" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The init script sets data-theme before hydration, so the attribute differs from the server render.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
        <style dangerouslySetInnerHTML={{ __html: themeCss() }} />
      </head>
      <body className="flex min-h-screen flex-col bg-bg text-fg antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <SessionProvider>
          <ServiceWorkerManager />
          <Header accountsEnabled={authIsConfigured()} />
          <OfflineBanner />
          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
            {children}
          </main>
          <Footer />
        </SessionProvider>
      </body>
    </html>
  );
}
