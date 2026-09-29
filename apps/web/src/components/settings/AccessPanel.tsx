"use client";

// Push notifications, personal access tokens and shared result links (21-roadmap-expansion.md,
// roadmap §2). All three are opt-in, all three need an account, and all three are disclosed plainly:
// push sends a notification's text to a relay, a token can act as you from a script, and a share link
// hands a file to anyone who has it. Each section says so where the control is, not in a footnote.
import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardDescription, CardTitle, Input } from "@onestop/ui";

interface PushPreference {
  enabled: boolean;
  topic: string;
  server?: string;
}

interface TokenRecord {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface ShareRecord {
  id: string;
  slug: string;
  title: string | null;
  expiresAt: string;
  revokedAt: string | null;
  viewCount: number;
  path: string;
  hasPassphrase: boolean;
}

function randomTopic(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return `onestop-${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 14)}`;
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "never";
}

export function AccessPanel() {
  const [push, setPush] = useState<PushPreference>({ enabled: false, topic: "" });
  const [tokens, setTokens] = useState<TokenRecord[]>([]);
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(true);

  const load = useCallback(async () => {
    try {
      const [pushRes, tokenRes, shareRes] = await Promise.all([
        fetch("/api/account/push", { cache: "no-store" }),
        fetch("/api/account/tokens", { cache: "no-store" }),
        fetch("/api/shares", { cache: "no-store" }),
      ]);
      if (pushRes.status === 503 || tokenRes.status === 503) {
        setAvailable(false);
        return;
      }
      const pushBody = (await pushRes.json()) as { push?: PushPreference | null };
      if (pushBody.push) setPush(pushBody.push);
      const tokenBody = (await tokenRes.json()) as { tokens?: TokenRecord[] };
      setTokens(tokenBody.tokens ?? []);
      const shareBody = (await shareRes.json()) as { shares?: ShareRecord[] };
      setShares(shareBody.shares ?? []);
    } catch {
      setAvailable(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async (input: RequestInfo, init: RequestInit, success: string) => {
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch(input, { ...init, headers: { "content-type": "application/json", ...init.headers } });
      const body = (await response.json()) as { ok?: boolean; error?: { message?: string }; token?: string };
      if (!response.ok || body.ok === false) {
        setNote(body.error?.message ?? "That did not work. Please try again.");
        return null;
      }
      setNote(success);
      return body;
    } catch {
      setNote("OneStop could not reach the server. Check your connection.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (!available) {
    return (
      <Card className="flex flex-col gap-2">
        <CardTitle>Push, tokens & sharing</CardTitle>
        <CardDescription>
          These need an account and a database. This OneStop is running without one, so every tool
          still works — but there is nothing to keep across devices.
        </CardDescription>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {note && (
        <p role="status" className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm">
          {note}
        </p>
      )}

      <Card className="flex flex-col gap-3">
        <div>
          <CardTitle>Push notifications to a phone</CardTitle>
          <CardDescription>
            Optional. When an automation finishes, OneStop can also send a notification through{" "}
            <a href="https://ntfy.sh" className="underline" target="_blank" rel="noreferrer noopener">
              ntfy
            </a>
            , a free open-source relay that needs no account — install its app, subscribe to your
            topic, and alerts reach you with the tab closed. <strong>The notification&rsquo;s title and
            text leave this machine when this is on.</strong> The in-app bell always works with no
            network at all.
          </CardDescription>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={push.enabled}
            disabled={busy}
            onChange={(e) => setPush((p) => ({ ...p, enabled: e.target.checked, topic: p.topic || randomTopic() }))}
          />
          Send push notifications
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">Topic</span>
            <Input
              value={push.topic}
              placeholder="onestop-something-unguessable"
              onChange={(e) => setPush((p) => ({ ...p, topic: e.target.value }))}
            />
            <span className="text-xs text-fg-muted">
              Treat this like a password: anyone who knows it can read your notifications.
            </span>
          </label>
          <Button variant="secondary" disabled={busy} onClick={() => setPush((p) => ({ ...p, topic: randomTopic() }))}>
            Generate
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || push.topic.trim() === ""}
            onClick={async () => {
              await send("/api/account/push", { method: "PUT", body: JSON.stringify(push) }, "Saved.");
              await load();
            }}
          >
            Save
          </Button>
          <Button
            variant="secondary"
            disabled={busy || push.topic.trim() === ""}
            onClick={() => void send("/api/account/push", { method: "POST" }, "Test notification sent — check your phone.")}
          >
            Send a test
          </Button>
          {push.topic !== "" && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                await send("/api/account/push", { method: "DELETE" }, "Removed.");
                setPush({ enabled: false, topic: "" });
              }}
            >
              Forget it
            </Button>
          )}
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <div>
          <CardTitle>Personal access tokens</CardTitle>
          <CardDescription>
            For your own scripts and cron jobs. A token calls{" "}
            <code className="rounded bg-surface-muted px-1">POST /api/tools/run</code> as you, through
            the same registry, the same validation and the same rate limit as the website — it can do
            nothing you could not do here. Send it as{" "}
            <code className="rounded bg-surface-muted px-1">Authorization: Bearer …</code>.
          </CardDescription>
        </div>

        {newToken && (
          <div className="rounded-md border border-warning/60 bg-surface-muted p-3">
            <p className="text-sm font-medium">Copy this now — it is never shown again.</p>
            <code className="mt-1 block overflow-x-auto rounded bg-surface px-2 py-1 font-mono text-xs break-all">
              {newToken}
            </code>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={() => {
                void navigator.clipboard?.writeText(newToken).catch(() => undefined);
                setNote("Token copied to the clipboard.");
              }}
            >
              Copy
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">What is it for?</span>
            <Input value={tokenName} placeholder="Nightly backup script" onChange={(e) => setTokenName(e.target.value)} />
          </label>
          <Button
            disabled={busy || tokenName.trim() === ""}
            onClick={async () => {
              const body = await send(
                "/api/account/tokens",
                { method: "POST", body: JSON.stringify({ name: tokenName }) },
                "Token created.",
              );
              if (body?.token) setNewToken(body.token);
              setTokenName("");
              await load();
            }}
          >
            Create token
          </Button>
        </div>

        {tokens.length === 0 ? (
          <p className="text-sm text-fg-muted">No tokens yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tokens.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {token.name}{" "}
                    <code className="text-xs text-fg-muted">{token.prefix}…</code>
                    {token.revokedAt && <span className="ml-2 text-xs text-danger">revoked</span>}
                  </span>
                  <span className="block text-xs text-fg-muted">
                    Created {when(token.createdAt)} · last used {when(token.lastUsedAt)}
                    {token.expiresAt ? ` · expires ${when(token.expiresAt)}` : ""}
                  </span>
                </span>
                {!token.revokedAt && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={async () => {
                      await send(`/api/account/tokens/${token.id}`, { method: "DELETE" }, "Token revoked.");
                      await load();
                    }}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <div>
          <CardTitle>Shared result links</CardTitle>
          <CardDescription>
            Links you have made from the History page. Each one is unguessable, expires on its own,
            and never outlives the files it points at. Anyone with the link can download those files,
            so revoke one the moment you are done with it.
          </CardDescription>
        </div>
        {shares.length === 0 ? (
          <p className="text-sm text-fg-muted">
            No shared links. Open an entry in History and choose “Share result” to make one.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shares.map((share) => (
              <li key={share.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{share.title ?? "Shared result"}</span>
                  <span className="block truncate text-xs text-fg-muted">
                    {share.path} · expires {when(share.expiresAt)} · {share.viewCount} view
                    {share.viewCount === 1 ? "" : "s"}
                    {share.hasPassphrase ? " · passphrase set" : ""}
                    {share.revokedAt ? " · revoked" : ""}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(`${window.location.origin}${share.path}`).catch(() => undefined);
                    setNote("Link copied to the clipboard.");
                  }}
                >
                  Copy link
                </Button>
                {!share.revokedAt && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={async () => {
                      await send(`/api/shares/${share.id}`, { method: "DELETE" }, "Link revoked.");
                      await load();
                    }}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
