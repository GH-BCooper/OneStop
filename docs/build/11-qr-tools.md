# Phase 11 — QR Tools

## Objective
Implement all QR tools from the Feature & Tool List.

## Depends On
04-file-core.md. (Dynamic QR + analytics will be *completed* in phase 13/14 once real persistence exists — see note below.)

## Tools Implemented This Phase
QR Code Generator, QR Code Scanner, URL → QR, Text → QR, Image → QR, Audio → QR, Contact → QR, Email → QR, Phone → QR, Wi-Fi → QR, Dynamic QR Code, Custom QR Landing Page, QR Code Customization, QR Code Analytics, QR Code → Content Page.

## Libraries
- `qrcode` (Node) for generation — fully offline.
- Browser `BarcodeDetector` API where available, with a JS fallback decode library, for scanning via camera (`getUserMedia`) — fully offline, client-side.

## Static vs Dynamic
- **Static QR tools** (generator, scanner, URL/Text/Image/Audio/Contact/Email/Phone/Wi-Fi → QR, customization) are fully offline and have no dependency beyond this phase — implement them completely now.
- **Dynamic QR, Custom Landing Page, Analytics, and QR → Content Page** need durable backend storage to be genuinely dynamic (the QR encodes a stable OneStop URL that redirects to editable content). Implement the full UI and API surface now, backed by local storage/IndexedDB as an interim store; note explicitly in code and in PROGRESS.md that this needs to be upgraded to Postgres-backed storage once phase 13 lands, and do that upgrade as a small follow-up task at the start of phase 14 rather than silently forgetting it.

## Modules / Files
`apps/api/qr/{generate.ts, formats.ts, dynamic.ts, analytics.ts}`; `apps/web/components/qr/{QRScanner.tsx, QRLandingPage.tsx}`.

## Acceptance Criteria
- [ ] Generator produces a valid, scannable QR code for each content type (verified by decoding it back).
- [ ] Wi-Fi QR produces a correctly formatted `WIFI:` config string; Contact QR produces valid vCard; Email/Phone produce correct `mailto:`/`tel:` URIs.
- [ ] Scanner correctly decodes a QR code via camera and via an uploaded image.
- [ ] Dynamic QR's underlying URL stays constant while its destination/content can be edited (even if backed by local storage for now).
- [ ] QR Code Analytics records at least scan count and last-scanned time.

## Test Cases
- Round-trip test: generate → decode for every content type listed above.
- Camera permission test: mock `getUserMedia` denial and confirm a clear "camera access needed" message, not a crash.
- Dynamic QR test: create a dynamic QR, change its destination, confirm the QR image/URL is unchanged but the resolved content is updated.
- Analytics test: simulate N scans, confirm the count matches.

## Notes
Flag in PROGRESS.md exactly which parts of Dynamic QR/Analytics are running on interim local storage vs. real backend storage, so phase 13/14 knows what to migrate.
