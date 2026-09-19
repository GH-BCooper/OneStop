// Spotify Link Processing — metadata only (17-online-media-network-tools.md, Features §9.7).
//
// The build file is explicit and this is a permanent decision, not a deferred feature:
//
//   "there is no legitimate way to rip audio directly from Spotify without violating its terms.
//    Implement Spotify Link Processing as metadata/info lookup only ... explicitly do not
//    implement Spotify audio downloading. This is a hard non-goal."
//
// So there is no download path in this file, and there is nothing here that could become one: the
// downloader module is never imported, no audio stream is ever opened, and the only network calls
// are to Spotify's own public oEmbed endpoint and the page's Open Graph tags. Both are free, need
// no account and no key, and return exactly what a link preview would show.
import { checkLink, unsupported } from "./common.ts";
import { decodeBody, safeFetch } from "../network/ssrf.ts";
import { failed } from "../network/common.ts";

export type SpotifyKind = "track" | "album" | "artist" | "playlist" | "show" | "episode" | "user";

const KINDS: SpotifyKind[] = ["track", "album", "artist", "playlist", "show", "episode", "user"];

export interface SpotifyLink {
  kind: SpotifyKind;
  id: string;
  url: string;
  uri: string;
}

export interface SpotifyInfo extends SpotifyLink {
  title: string | null;
  /** The artist, show or owner, as the preview names it. */
  by: string | null;
  description: string | null;
  thumbnail: string | null;
  /** Milliseconds, when the preview exposes it (tracks and episodes). */
  durationMs: number | null;
  releaseDate: string | null;
  provider: string;
  note: string;
}

/** "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT" -> kind + id. */
export function parseSpotifyLink(raw: string): SpotifyLink {
  const text = raw.trim();

  // The `spotify:track:<id>` URI form people copy out of the desktop app.
  const uri = /^spotify:([a-z]+):([A-Za-z0-9]+)$/.exec(text);
  if (uri) {
    const kind = uri[1] as SpotifyKind;
    if (!KINDS.includes(kind))
      throw unsupported(`"${uri[1]}" is not a Spotify item this tool can look up.`);
    return { kind, id: uri[2]!, url: `https://open.spotify.com/${kind}/${uri[2]}`, uri: text };
  }

  const url = new URL(checkLink(text, "spotify"));
  // Locale-prefixed links: /intl-de/track/…
  const segments = url.pathname.split("/").filter((s) => s !== "" && !/^intl-/.test(s));
  const [kindSegment, id] = segments;
  if (!kindSegment || !id || !KINDS.includes(kindSegment as SpotifyKind)) {
    throw unsupported(
      "That Spotify link does not point at a track, album, artist, playlist, show or episode.",
    );
  }
  if (!/^[A-Za-z0-9]{6,40}$/.test(id)) throw unsupported("That Spotify link has an unreadable id.");
  const kind = kindSegment as SpotifyKind;
  return {
    kind,
    id,
    url: `https://open.spotify.com/${kind}/${id}`,
    uri: `spotify:${kind}:${id}`,
  };
}

interface OEmbed {
  title?: string;
  thumbnail_url?: string;
  provider_name?: string;
  html?: string;
}

function metaContent(html: string, key: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const reversed = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
    "i",
  );
  const value = pattern.exec(html)?.[1] ?? reversed.exec(html)?.[1] ?? null;
  return value
    ? value
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim()
    : null;
}

export interface SpotifyLookupOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Reads the public preview of a Spotify link. No audio, no stream URL, no token — the oEmbed
 * endpoint and the page's own preview tags are the whole of it.
 */
export async function lookupSpotify(
  raw: string,
  options: SpotifyLookupOptions = {},
): Promise<SpotifyInfo> {
  const link = parseSpotifyLink(raw);
  const fetchOptions = {
    maxBytes: 512 * 1024,
    timeoutMs: 12_000,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };

  let oembed: OEmbed = {};
  try {
    const response = await safeFetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(link.url)}`,
      { ...fetchOptions, headers: { accept: "application/json" } },
    );
    if (response.status === 404) {
      throw unsupported("That Spotify item does not exist, or is not public.");
    }
    if (response.status < 400) oembed = JSON.parse(decodeBody(response)) as OEmbed;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw failed("Spotify sent back something unreadable. Try again in a moment.", err);
    }
    throw err;
  }

  // The page's Open Graph tags fill in what oEmbed leaves out: who it is by, the description and
  // the duration.
  let page = "";
  try {
    const response = await safeFetch(link.url, {
      ...fetchOptions,
      headers: { accept: "text/html" },
    });
    if (response.status < 400) page = decodeBody(response);
  } catch (err) {
    console.error("[online-media:spotify-link-info] the preview page did not answer", err);
  }

  const title = oembed.title ?? metaContent(page, "og:title");
  const description = metaContent(page, "og:description");
  const durationText = metaContent(page, "music:duration");
  const duration = durationText ? Number(durationText) * 1000 : null;

  if (!title && page === "") {
    throw failed("Spotify did not answer for that link. Try again in a moment.");
  }

  return {
    ...link,
    title: title ?? null,
    by:
      metaContent(page, "music:musician_description") ??
      metaContent(page, "music:musician") ??
      // og:description on a track reads "Song · Artist · 2019".
      description?.split("·")[1]?.trim() ??
      null,
    description: description ?? null,
    thumbnail: oembed.thumbnail_url ?? metaContent(page, "og:image") ?? null,
    durationMs: Number.isFinite(duration) && duration ? duration : null,
    releaseDate: metaContent(page, "music:release_date"),
    provider: oembed.provider_name ?? "Spotify",
    note: "Information only. OneStop does not download audio from Spotify.",
  };
}
