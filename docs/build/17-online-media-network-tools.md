# Phase 17 — Online Media & Network/Info Utilities

## Objective
Implement the Internet-required tools: YouTube/Instagram/Spotify link tools and the Network/Info utilities, with strict legal and reliability guardrails since this is the module most likely to break the rest of the app if handled carelessly.

## Depends On
04-file-core.md

## Tools Implemented This Phase
**Online Media:** YouTube → MP3/MP4 + Quality Selector, Instagram Reel → MP3/MP4 + Quality Selector, Spotify Link Processing.

**Network/Info:** IP Address Lookup, Public IP Detector, IP Geolocation, Location Lookup, Coordinates Lookup, User-Agent Lookup, DNS Lookup, WHOIS Lookup, Website Information Lookup.

## Critical Legal/Ethical Constraint
- Use `yt-dlp` (free, open-source, local) for YouTube/Instagram. This must respect each platform's Terms of Service and copyright law — the app does not circumvent DRM and is not a tool for downloading copyrighted content the user doesn't have rights to. Put a clear, visible notice near these tools stating the user is responsible for the legality of what they download.
- **Spotify:** there is no legitimate way to rip audio directly from Spotify without violating its terms. Implement **Spotify Link Processing as metadata/info lookup only** (track/album/artist info from a link) — explicitly **do not** implement Spotify audio downloading. This is a hard non-goal, not a deferred feature.

## Free/No-Cost Constraint for Network Tools
- IP Geolocation/Location Lookup: use a free-tier-compatible or self-hosted approach (e.g. a local GeoLite2 database) rather than a paid geolocation API, to avoid both cost and rate-limit fragility.
- DNS/WHOIS Lookup: Node's built-in `dns` module plus a lightweight WHOIS client library — no paid service needed.

## Modules / Files
`apps/api/online-media/{ytdlp.ts, spotifyInfo.ts}`; `apps/api/network/{ipLookup.ts, geo.ts, dns.ts, whois.ts, userAgent.ts, siteInfo.ts}`.

## Isolation Requirement
Every tool in this file is Internet-dependent and must be wrapped so that a failure (timeout, rate limit, platform change breaking `yt-dlp`, no connectivity) **never crashes or blocks any other part of the app** — use try/catch at the boundary and the standard §22 message: "This tool needs an Internet connection. Connect and try again," or a more specific message where you have one (e.g. "This video is unavailable or restricted").

## Acceptance Criteria
- [ ] YouTube/Instagram tools successfully download and convert a real public test video, respecting quality selection.
- [ ] Spotify tool returns accurate metadata only — confirm no audio-ripping code path exists at all.
- [ ] All network/info lookups return correct data for a known test IP/domain.
- [ ] Simulated offline mode: every tool in this file shows the correct blocked message; the rest of the app (any other tool) continues working normally at the same time.
- [ ] The legal notice is visible on the Online Media tool pages.

## Test Cases
- Use interface-level mocks for `yt-dlp` in automated tests (do not hardcode real copyrighted video URLs into the test suite) — verify the wrapper's option-passing and error-handling logic, not live downloads, in CI.
- Network lookup tests against known-good test values (e.g. `8.8.8.8`, `example.com`), with real network calls mocked in CI and only exercised manually/locally.
- Failure isolation test: force one tool in this module to fail/time out, confirm no other part of the app is affected.

## Notes
Log in PROGRESS.md that Spotify audio downloading was deliberately excluded and why — this is a permanent decision, not a "phase 2" item, unless the user explicitly overrides it later with full awareness of the legal implications.
