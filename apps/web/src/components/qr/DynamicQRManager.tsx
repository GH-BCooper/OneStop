"use client";

// Managing dynamic QR codes (11-qr-tools.md).
//
// This is the half of a dynamic code that makes it dynamic: the list of codes already made, and
// the ability to re-point, rename, pause or delete one. The QR image and its `/q/<id>` URL are
// never touched — only what that id resolves to.
import { Button, Card, Input } from "@onestop/ui";
import { useCallback, useEffect, useState } from "react";

export interface QrCodeStats {
  id: string;
  title: string;
  kind: "redirect" | "page";
  shortUrl: string;
  destination?: string;
  active: boolean;
  scans: number;
  scansLast7Days: number;
  lastScannedAt: string | null;
  createdAt: string;
  destinationChanges: number;
}

const LIST_ENDPOINT = "/api/qr/links";

function when(value: string | null): string {
  if (!value) return "never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "never" : date.toLocaleString();
}

export interface DynamicQRManagerProps {
  /** "manage" shows the editing controls; "analytics" is read-only. */
  mode?: "manage" | "analytics";
}

export function DynamicQRManager({ mode = "manage" }: DynamicQRManagerProps) {
  const [codes, setCodes] = useState<QrCodeStats[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [editing, setEditing] = useState<string>("");
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(LIST_ENDPOINT, { cache: "no-store" });
      const data = (await response.json()) as { ok: boolean; codes?: QrCodeStats[] };
      if (!data.ok || !data.codes) throw new Error("bad response");
      setCodes(data.codes);
    } catch {
      setCodes([]);
      setError("Your QR codes could not be loaded. Reload the page to try again.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id);
    setError("");
    try {
      const response = await fetch(`${LIST_ENDPOINT}/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as {
        ok: boolean;
        code?: QrCodeStats;
        error?: { message: string };
      };
      if (!data.ok || !data.code) {
        setError(data.error?.message ?? "That change could not be saved.");
        return;
      }
      const updated = data.code;
      setCodes((current) => (current ?? []).map((c) => (c.id === id ? updated : c)));
      setEditing("");
    } catch {
      setError("That change could not be saved. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    setError("");
    try {
      const response = await fetch(`${LIST_ENDPOINT}/${id}`, { method: "DELETE" });
      const data = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!data.ok) {
        setError(data.error?.message ?? "That code could not be deleted.");
        return;
      }
      setCodes((current) => (current ?? []).filter((c) => c.id !== id));
    } catch {
      setError("That code could not be deleted. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  if (codes === null) {
    return (
      <Card data-testid="qr-manager">
        <p className="text-sm text-fg-muted">Loading your QR codes…</p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4" data-testid="qr-manager">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {mode === "analytics" ? "Your codes and their scans" : "Codes you can re-point"}
        </h2>
        <Button variant="ghost" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {error && (
        <p role="status" className="text-sm text-danger">
          {error}
        </p>
      )}

      {codes.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No dynamic codes yet. Make one above and it will appear here, ready to be re-pointed
          whenever you like.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {codes.map((code) => (
            <li
              key={code.id}
              className="flex flex-col gap-2 rounded-lg border border-border p-3"
              data-testid="qr-manager-row"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{code.title}</span>
                <span className="text-sm text-fg-muted">
                  {code.scans} scan{code.scans === 1 ? "" : "s"} · last {when(code.lastScannedAt)}
                </span>
              </div>

              <a
                href={code.shortUrl}
                rel="noreferrer noopener"
                target="_blank"
                className="font-mono text-sm break-all text-primary underline"
              >
                {code.shortUrl}
              </a>

              <p className="text-sm text-fg-muted break-all">
                {code.kind === "redirect"
                  ? `Opens ${code.destination ?? "nothing yet"}`
                  : "Opens a OneStop-hosted page"}
                {code.destinationChanges > 0 &&
                  ` · re-pointed ${code.destinationChanges} time${code.destinationChanges === 1 ? "" : "s"}`}
                {!code.active && " · paused"}
              </p>

              {mode === "manage" && (
                <>
                  {editing === code.id ? (
                    <div className="flex flex-col gap-2">
                      <Input
                        label="New destination"
                        value={draft}
                        placeholder="https://example.com"
                        onChange={(e) => setDraft(e.target.value)}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={busyId === code.id}
                          onClick={() => void patch(code.id, { target: draft })}
                        >
                          Save destination
                        </Button>
                        <Button variant="ghost" onClick={() => setEditing("")}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {code.kind === "redirect" && (
                        <Button
                          variant="secondary"
                          disabled={busyId === code.id}
                          onClick={() => {
                            setEditing(code.id);
                            setDraft(code.destination ?? "");
                          }}
                        >
                          Change destination
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        disabled={busyId === code.id}
                        onClick={() => void patch(code.id, { active: !code.active })}
                      >
                        {code.active ? "Pause" : "Resume"}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busyId === code.id}
                        onClick={() => void remove(code.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </>
              )}

              {mode === "analytics" && (
                <p className="text-sm text-fg-muted">
                  {code.scansLast7Days} in the last 7 days · made {when(code.createdAt)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-fg-muted">
        Scan counts record only a timestamp and a rough device type — never an IP address or
        anything that identifies who scanned.
      </p>
    </Card>
  );
}
