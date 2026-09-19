"use client";

// Registers the service worker and offers the update when a new build is waiting
// (18-pwa-offline.md). Mounted once, in the root layout.
//
// The update prompt is deliberately a prompt and not an automatic reload: a reload in the middle of
// a long conversion would throw the result away. The worker only takes over when the user says so,
// or on the next visit.
import { Button } from "@onestop/ui";
import { useEffect, useState } from "react";
import { activateUpdate, registerServiceWorker } from "@/lib/service-worker";

export function ServiceWorkerManager() {
  const [waiting, setWaiting] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    let cancelled = false;
    let registration: ServiceWorkerRegistration | null = null;

    const offerUpdate = (reg: ServiceWorkerRegistration) => {
      // `waiting` with an existing controller means "a new build is ready, the old one is in use".
      if (reg.waiting && navigator.serviceWorker.controller && !cancelled) setWaiting(reg);
    };

    void registerServiceWorker().then((result) => {
      if (cancelled || !result.registration) return;
      registration = result.registration;
      offerUpdate(registration);
      registration.addEventListener("updatefound", () => {
        const installing = registration?.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed" && registration) offerUpdate(registration);
        });
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!waiting) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-3 border-b border-border bg-surface-muted px-4 py-2 text-sm"
    >
      <span>A new version of OneStop is ready.</span>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          activateUpdate(waiting);
          // The new worker claims the page on activation; reloading picks up the new shell.
          window.location.reload();
        }}
      >
        Reload to update
      </Button>
    </div>
  );
}
