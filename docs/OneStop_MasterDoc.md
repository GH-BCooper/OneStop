# OneStop

**One-Stop AI-Powered Utility Platform**

Product + Architecture + Features + Routes + Build Blueprint

**Primary use:** Personal use + friends / small trusted user group

**Deployment:** Localhost + free-tier hosted web app

**Cost goal:** No mandatory paid software, API or infrastructure

**Offline goal:** All technically feasible tools work offline

**Mobile:** PWA first; native wrapper/app later if useful

**Product statement:** OneStop is a single place to perform file conversion, PDF, image, data, QR, media, AI and utility tasks. Users can either open a specific tool from the catalogue or describe a task to the AI Assistant, which selects and orchestrates OneStop tools. Internet-dependent tools fail gracefully when offline; they do not break the rest of the application.

September 2026

---

# OneStop Master Product Plan

## Contents

1. Product Definition — 3
2. Core Product Principles — 3
3. Final Application Structure — 3
&nbsp;&nbsp;&nbsp;&nbsp;3.1 Main routes — 3
4. Feature Catalogue — 4
&nbsp;&nbsp;&nbsp;&nbsp;4.1 PDF — 4
&nbsp;&nbsp;&nbsp;&nbsp;4.2 Documents / Word / PowerPoint — 4
&nbsp;&nbsp;&nbsp;&nbsp;4.3 Excel / CSV / Data — 4
&nbsp;&nbsp;&nbsp;&nbsp;4.4 Images — 4
&nbsp;&nbsp;&nbsp;&nbsp;4.5 Audio / Video — 4
&nbsp;&nbsp;&nbsp;&nbsp;4.6 QR — 5
&nbsp;&nbsp;&nbsp;&nbsp;4.7 AI — 5
&nbsp;&nbsp;&nbsp;&nbsp;4.8 Utilities / Developer — 5
5. Home Page — 5
6. All Tools Page — 5
7. AI Assistant — 5
&nbsp;&nbsp;&nbsp;&nbsp;7.1 Behavior — 6
&nbsp;&nbsp;&nbsp;&nbsp;7.2 Tool calling pipeline — 6
&nbsp;&nbsp;&nbsp;&nbsp;7.3 External recommendations — 6
8. Workflows — 6
9. History and Accounts — 6
10. Offline / Online Model — 7
11. Recommended Technical Architecture — 7
12. Backend Modules — 8
13. Tool Registry — 8
14. File Processing Pipeline — 9
15. Security and Privacy — 9
16. Data Model — 10
17. Project Structure — 10
18. Hosting and Local Development — 11
&nbsp;&nbsp;&nbsp;&nbsp;18.1 Local — 11
&nbsp;&nbsp;&nbsp;&nbsp;18.2 Hosted — 11
19. PWA and Mobile Strategy — 11
20. UX Requirements — 11
21. Search and Discovery — 12
22. Error and Offline UX — 12
23. Testing Strategy — 12
24. Build Order — 13
25. Recommended BUILD.md Breakdown for Claude Code — 13
26. Final Scope Decision — 14
27. Final Product Definition — 14

---

## 1. Product Definition

OneStop has two central experiences:

1. **AI Assistant** — a conversational page that understands a request, chooses OneStop tools, runs them in sequence, and returns the result.
2. **All Tools** — a searchable, categorized directory where every tool can be opened and used directly.

The application should remain deliberately simple. Do not introduce microservices, complicated role systems, enterprise billing, Kubernetes, or unnecessary infrastructure. The target is a high-quality personal/small-group application, not a mass-market SaaS platform.

## 2. Core Product Principles

1. **Local-first:** process files on the user's machine whenever practical.
2. **Hybrid:** use the Internet only where the task genuinely needs it.
3. **Offline-friendly:** offline-capable tools continue to work; online-only tools show a clear connection-required state.
4. **Free-first:** rely on open-source libraries and free hosting/services. Avoid mandatory paid APIs.
5. **Simple auth:** email/password + Google login; no complex authorization model initially.
6. **Privacy:** temporary files should be deleted automatically; cloud storage is opt-in.
7. **One tool registry:** every tool has metadata, capabilities, input/output types and execution mode so the UI and AI can use the same source of truth.
8. **Composable tools:** compatible tools can be chained into workflows.

## 3. Final Application Structure

```
HOME
|-- AI Assistant
|-- All Tools
|   |-- PDF
|   |-- Documents / Word / PowerPoint
|   |-- Excel / CSV / Data
|   |-- Images
|   |-- Audio / Video
|   |-- QR
|   |-- AI
|   `-- Utilities / Developer
|-- Workflows
|-- History
|-- Account
`-- Settings
```

### 3.1 Main routes

| Page | Route | Purpose |
|------|-------|---------|
| Home | `/` | Search, AI entry point, categories, recent tools. |
| AI Assistant | `/assistant` | Natural-language task execution. |
| All Tools | `/tools` | Searchable tool catalogue. |
| Category | `/tools/:category` | Tools within one category. |
| Tool | `/tools/:category/:slug` | Individual tool UI. |
| Workflows | `/workflows` | Saved workflows. |
| New Workflow | `/workflows/new` | Create workflow. |
| Workflow | `/workflows/:id` | Edit/run saved workflow. |
| History | `/history` | Previous jobs and results. |
| Account | `/account` | Profile and basic account settings. |
| Settings | `/settings` | App, privacy and AI settings. |
| Login | `/auth/login` | Login. |
| Signup | `/auth/signup` | Registration. |
| Reset | `/auth/reset-password` | Password reset. |
| Status | `/status` | Online/offline capability status. |

## 4. Feature Catalogue

### 4.1 PDF

- PDF ↔ Word, Excel, PowerPoint where conversion quality is practical.
- PDF ↔ image; PDF → text; OCR PDF.
- Merge, split, extract pages, delete/reorder pages, rotate pages.
- Compress, resize, watermark, page numbers, sign, fill forms, compare PDFs.
- Password-protect PDFs and unlock only when the user is authorized to do so.

### 4.2 Documents / Word / PowerPoint

- Word ↔ PDF, Word ↔ Excel, PowerPoint ↔ PDF.
- Text extraction, document merger/splitter, translation, grammar correction and formatting.

### 4.3 Excel / CSV / Data

- Excel ↔ CSV, JSON and XML where mappings are well defined.
- CSV ↔ JSON/XML; JSON ↔ XML.
- Spreadsheet cleaning, duplicate removal, split/merge, formatting and validation.

### 4.4 Images

- Resize, crop, compress, convert JPG/PNG/WebP/GIF, watermark, text overlay.
- Background blur/removal, object removal, enhancement, upscaling, sharpening.
- Fit to square or circle using fill, contain, stretch, repeat or blurred background.
- Image ↔ PDF, image metadata viewer/remover and simple image editor.

### 4.5 Audio / Video

- Video → audio, audio/video conversion, compression, trimming and merging.
- YouTube/Instagram/Spotify link tools only where technically permitted and consistent with the relevant platform's terms and copyright requirements.
- Quality selection for supported video downloads.

### 4.6 QR

- QR generator and scanner.
- URL, text, contact, Wi-Fi, email, phone, image and custom-content QR codes.
- Dynamic QR with a OneStop landing page, optional analytics and editable destination/content.

### 4.7 AI

- AI Assistant, email drafting, text rewriting, summarization, translation and document Q&A.
- Ask questions about uploaded PDFs/documents.
- AI image generation/editing when local hardware can support it.
- External-tool recommendations for tasks OneStop does not support directly.

### 4.8 Utilities / Developer

- IP lookup, location lookup, user-agent lookup.
- URL encoding/decoding, Base64, UUID, password generation, hashing, timestamps.
- JSON/XML/HTML formatting and validation, Markdown conversion, checksums, ZIP/unZIP.
- File metadata inspection and removal.

## 5. Home Page

The Home page should be intentionally minimal:

1. Large search box: "What do you want to do?"
2. Primary button: "Ask OneStop AI".
3. Category cards.
4. Popular/recent tools.
5. Recent jobs for signed-in users.
6. A small offline/online indicator.

## 6. All Tools Page

The Tools page is the complete catalogue. It must support:

- Search by natural text, tool name and keyword.
- Category and subcategory filters.
- Tags such as offline, online, AI, file, image.
- Sort by name, popularity and recently used.
- Clear cards showing input, output, offline support and a one-line description.

Each tool gets one canonical route and one metadata entry in the tool registry.

## 7. AI Assistant

The AI Assistant is the main differentiator.

### 7.1 Behavior

The assistant receives a user request and chooses from the tool registry. It may execute one tool or compose several compatible tools.

Example:

```
User: Convert this PDF to Excel, remove the first 2 pages,
then compress the result.

AI plan:
1. PDF -> Excel
2. Remove pages 1-2
3. Compress output
4. Return final file
```

### 7.2 Tool calling pipeline

```
User request
-> Intent detection
-> Tool discovery from registry
-> Validate inputs / permissions
-> Build execution plan
-> Execute tool(s)
-> Validate outputs
-> Show progress
-> Return file/result
```

The AI should not invent tools. It must choose from registered capabilities. If the request cannot be completed, it should explain what is missing and, where appropriate, recommend external tools.

### 7.3 External recommendations

For unsupported/advanced tasks, show two groups:

- Free / free tier recommendations.
- Paid / premium recommendations.

Each recommendation should contain the site name, link, purpose and relevant limitation. Recommendations require Internet access and should be clearly labeled as external services.

## 8. Workflows

Workflows are reusable chains of OneStop tools.

Examples:

```
Images -> Create PDF -> Compress PDF
PDF -> OCR -> Translate -> PDF
CSV -> Clean -> Convert to Excel
Image -> Remove Background -> Resize -> WebP
```

Initial workflow model should stay simple: ordered steps with typed inputs/outputs. Add branching/conditions only if they become genuinely necessary.

## 9. History and Accounts

Authentication is included, but kept simple:

- Email + password.
- Google OAuth.
- Password reset.
- Basic profile.

Authenticated users get:

- History of tool executions.
- Saved workflows.
- Favorite/recent tools.
- Basic preferences.

Guest/local users can still use public tools. Local history may be stored in the browser, but it is not synchronized until the user signs in.

## 10. Offline / Online Model

OneStop should never make the whole application dependent on an Internet connection.

| Capability | Offline | Notes |
|------------|---------|-------|
| PDF/image/data processing | Yes | Prefer browser/local backend processing. |
| QR generation/scanning | Yes | Browser/device based. |
| Audio/video conversion | Yes | Local FFmpeg or equivalent. |
| OCR | Yes* | Local OCR/model where feasible. |
| Local AI Assistant | Yes* | Requires a local model/runtime and suitable hardware. |
| AI image generation | Yes* | Hardware-dependent and optional. |
| YouTube/Instagram/Spotify link tools | No | Require Internet and may have platform/legal restrictions. |
| IP/location lookup | No | Requires external network information. |
| External recommendations | No | Requires Internet. |
| Cloud history/workflows/account sync | No | Requires authenticated online connection. |

**Offline error behavior:** an Internet-only tool should show a clear message such as "Internet connection required. Please connect and try again." It should not crash the application.

## 11. Recommended Technical Architecture

Keep the stack conventional and easy to maintain.

| Layer | Recommendation | Reason |
|-------|----------------|--------|
| Frontend | Next.js + TypeScript | One web application, routing and PWA support. |
| UI | Tailwind CSS + component library | Fast, consistent UI development. |
| Client state | React state + small state library only when needed | Avoid unnecessary complexity. |
| Backend | Node.js + NestJS (or a simple Next.js API layer initially) | Typed APIs and clean modules. |
| Heavy processing | Local Python where Python libraries are materially better | PDF/OCR/data tooling. |
| Database | PostgreSQL | Accounts, history, workflows and settings. |
| Auth | Supabase Auth or equivalent free-tier provider | Avoid writing authentication infrastructure. |
| Local storage | IndexedDB | Offline preferences, local history and cached metadata. |
| Files | Temporary local filesystem / browser blobs; optional object storage online | Avoid permanent large-file storage. |
| Queue | In-process jobs initially; Redis only if truly needed later | Keep the first version simple. |
| AI runtime | Local model runtime such as Ollama; optional external APIs | No mandatory paid AI provider. |
| Media | FFmpeg | Broad local media processing support. |
| Deployment | Free-tier frontend/backend/database providers | Fits the project goal. |
| Mobile | PWA first; wrapper/native app later | Reuse the web application. |

Do not split the application into microservices at the beginning. Use one logical backend with clearly separated modules. A separate processing worker can be introduced later if a real bottleneck appears.

## 12. Backend Modules

```
auth
users
history
workflows
tool-registry
file-processing
pdf
office
data
image
media
qr
ai
external-recommendations
health
```

Each tool module should expose a stable service contract rather than allowing the AI or UI to call internal implementation details.

## 13. Tool Registry

Every tool should have metadata similar to:

```json
{
  "id": "pdf-to-word",
  "name": "PDF to Word",
  "category": "pdf",
  "inputTypes": ["pdf"],
  "outputTypes": ["docx"],
  "execution": "local",
  "offline": true,
  "supportsBatch": true,
  "requiresAuth": false,
  "description": "Convert a PDF into an editable Word document."
}
```

The same registry powers:

- tool discovery;
- category pages;
- AI tool selection;
- capability checks;
- workflow validation;
- UI labels such as "Works offline".

## 14. File Processing Pipeline

Every file-based operation should follow a predictable pipeline:

```
Select / upload file
-> Validate file type and size
-> Create job
-> Detect execution mode
-> Process locally or remotely
-> Validate output
-> Show result
-> Optional download / save to history
-> Delete temporary data
```

For workflows, repeat the same pipeline per step and pass validated output to the next step.

## 15. Security and Privacy

Even for personal use, basic safeguards are required:

- Validate MIME type, extension and file size.
- Sanitize filenames and paths.
- Never execute uploaded files.
- Delete temporary server files after a short retention period.
- Use HTTPS for hosted deployment.
- Store passwords only through a trusted authentication system using secure password hashing.
- Keep secrets in environment variables; never commit API keys.
- Limit externally fetched URLs and validate redirects to reduce SSRF risk.
- Do not allow the AI to execute arbitrary shell commands.

## 16. Data Model

Keep the database small.

```
User
- id
- email
- name
- avatar
- createdAt

Job
- id
- userId (nullable for guest/local jobs)
- toolId
- status
- inputMetadata
- outputMetadata
- createdAt

Workflow
- id
- userId
- name
- description
- steps
- createdAt
- updatedAt

UserSettings
- userId
- theme
- preferredAI
- other small preferences
```

Do not store raw file binaries in PostgreSQL.

## 17. Project Structure

A practical monorepo structure:

```
onestop/
|-- apps/
|   |-- web/                # Next.js frontend + PWA
|   `-- api/                # Backend/API
|-- packages/
|   |-- ui/                 # Shared UI components
|   |-- types/              # Shared TypeScript types
|   |-- tool-registry/      # Tool definitions/capabilities
|   `-- config/             # Shared configuration
|-- processors/
|   `-- python/             # Python-heavy processing modules
|-- docs/
|-- scripts/
|-- .env.example
|-- docker-compose.yml      # Optional local services
`-- README.md
```

## 18. Hosting and Local Development

The application must work in two modes.

### 18.1 Local

```
Browser -> local frontend -> local API -> local processors
-> local PostgreSQL (or embedded dev DB)
-> local AI runtime (optional)
```

### 18.2 Hosted

```
Browser -> hosted frontend -> hosted API
-> free PostgreSQL
-> optional temporary object storage
-> external APIs only when required
```

The hosted deployment should not require paid services for the basic application. Free-tier quotas and provider policies can change, so configuration should remain portable.

## 19. PWA and Mobile Strategy

Build the web application first. Make it installable as a PWA with:

- responsive layout;
- manifest and icons;
- service worker for app shell/caching;
- offline tool availability where supported;
- camera access for QR scanning when supported by the device/browser.

Only after the web application is stable should a mobile wrapper or native application be considered. This avoids maintaining two codebases prematurely.

## 20. UX Requirements

Every tool page should have the same basic pattern:

```
Title + short description
|
Input area / drop zone
|
Options
|
Primary action button
|
Progress / processing state
|
Result + Download / Save / Run Again
```

Important states must exist for every tool:

- empty;
- drag/drop or file selected;
- validating;
- processing;
- success;
- failed;
- offline/unavailable;
- unsupported input.

## 21. Search and Discovery

The search box should search both tools and capabilities. Examples:

- "make a pdf from images" → Image to PDF.
- "remove background" → Background Removal.
- "compress my video" → Video Compression.
- "convert csv to json" → CSV to JSON.

The same natural-language capability matching can later be reused by the AI Assistant.

## 22. Error and Offline UX

Errors should be actionable rather than technical.

Examples:

- "This tool needs an Internet connection. Connect and try again."
- "This file type is not supported."
- "The file is too large for local processing. Try a smaller file."
- "The local AI model is not available. Start the configured local model runtime or switch to an online provider."

The application should log technical details for debugging while showing simple messages to users.

## 23. Testing Strategy

Prioritize practical tests:

1. Unit tests for processors and utility functions.
2. Integration tests for API endpoints.
3. Tool-contract tests: every registry entry must map to an available implementation.
4. Workflow tests with multiple steps.
5. Authentication tests.
6. Offline tests for tools marked offline-capable.
7. Browser tests for the most important user journeys.

A tool should not be marked "offline" until an actual offline test succeeds.

## 24. Build Order

Build in this order to keep the project manageable:

1. Repository, linting, formatting and environment setup.
2. Next.js UI shell, routing and design system.
3. Tool registry and generic tool page framework.
4. Local file handling.
5. Core PDF/image/data tools.
6. Authentication and database.
7. History.
8. Workflows.
9. AI Assistant and tool-calling.
10. Online-only tools and external recommendations.
11. PWA/offline caching.
12. Optional local AI and AI image generation.
13. Deployment and final testing.

## 25. Recommended BUILD.md Breakdown for Claude Code

Do not give Claude Code one enormous implementation task. Use small, ordered build documents:

1. `01-foundation.md` — repo, tooling, environment, coding standards.
2. `02-ui-shell.md` — layout, navigation, theme, responsive design.
3. `03-tool-registry.md` — registry and generic tool framework.
4. `04-file-core.md` — upload, validation, temp files, job model.
5. `05-pdf-tools.md` — PDF processors.
6. `06-office-data-tools.md` — Word/Excel/PPT/CSV/JSON/XML.
7. `07-image-tools.md` — image processors.
8. `08-media-qr-tools.md` — media and QR utilities.
9. `09-auth-data.md` — authentication, PostgreSQL, history.
10. `10-workflows.md` — reusable tool chains.
11. `11-ai-assistant.md` — tool discovery, planning and execution.
12. `12-online-tools.md` — Internet-required tools and connectivity handling.
13. `13-pwa-offline.md` — service worker, caching and offline UX.
14. `14-testing-deployment.md` — tests, local setup and free-tier deployment.

Each BUILD.md should specify: objective, files/modules to change, interfaces, dependencies, acceptance criteria, test cases and explicit non-goals. Claude Code should complete and verify one module before moving to the next.

## 26. Final Scope Decision

The initial product should retain the requested feature set, but the implementation should remain simple underneath.

**Keep:** PDF/document conversion, spreadsheet/data conversion, image tools, media tools, QR tools, utility tools, AI Assistant, workflows, history, authentication, offline support, PWA, and external recommendations.

**Avoid initially:** microservices, complex roles, billing/subscriptions, enterprise administration, multi-region infrastructure, mandatory paid APIs, permanent file storage, complicated workflow branching, and a separate native mobile codebase.

The fundamental architecture is:

```
+----------------------+
|       OneStop        |
+----------+-----------+
           |
+-------------+-------------+
|                           |
AI Assistant            All Tools
|                           |
+-------------+-------------+
              |
        Tool Registry
              |
+------------------+------------------+
|                  |                  |
Local tools    Online tools       Workflows
|                  |                  |
Browser/Local  Internet/APIs    Chained tools
|                  |                  |
+------------------+------------------+
                   |
           History / Account
                   |
           PostgreSQL + Auth
```

## 27. Final Product Definition

OneStop is a local-first, AI-assisted, all-in-one utility platform for personal and small-group use. It provides a single interface for converting and manipulating documents, PDFs, spreadsheets, images, audio/video, QR codes and data, while also offering AI assistance, workflows, history and accounts.

The product should be:

- easy to run on localhost;
- deployable on free-tier hosting;
- useful without Internet for all feasible local tools;
- graceful when Internet-only features are unavailable;
- free to build and operate at the intended small scale;
- simple enough to maintain as a single project;
- structured so Claude Code can implement it incrementally through BUILD.md files.

The guiding rule for every future feature is simple: **add capability without adding unnecessary architectural complexity.**
