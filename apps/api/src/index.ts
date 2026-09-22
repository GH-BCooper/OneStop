export { PYTHON_PROCESSORS_DIR, PythonBridgeError, runPython } from "./python-bridge.ts";
export type { PythonBridgeErrorCode, RunPythonOptions } from "./python-bridge.ts";
export * from "./file-processing/index.ts";
export * from "./progress/store.ts";
// The database module: the Prisma client, the Postgres job store and the auth services
// (13-auth-database.md). Importing `./db/register.ts` makes `getJobStore()` durable.
export * from "./db/index.ts";
import "./db/register.ts";
export * from "./auth/index.ts";
// History, favourites and settings sync (14-history-favorites.md).
export * from "./history/index.ts";
export * from "./favorites/index.ts";
// Importing the PDF module registers the phase-05 and phase-06 executors.
export * from "./pdf/index.ts";
// The shared Office ⇄ PDF interface (06-pdf-tools-advanced.md), reused by phases 07 and 08.
export * from "./shared/office-convert.ts";
export * from "./shared/rate-limit.ts";
// Importing the documents module registers the phase-07 Word & PowerPoint executors.
export * from "./documents/index.ts";
// Importing the data module registers the phase-08 Excel, CSV & data-conversion executors.
export * from "./data/index.ts";
// Importing the images module registers the phase-09 image executors.
export * from "./images/index.ts";
// Importing the media module registers the phase-10 audio & video executors.
export * from "./media/index.ts";
// Importing the QR module registers the phase-11 QR executors.
export * from "./qr/index.ts";
// Importing the dev-utils module registers the phase-12 developer & file utility executors.
export * from "./dev-utils/index.ts";
// Workflows: reusable tool chains, the run engine and batch processing (15-workflows.md).
export * from "./workflows/index.ts";
// The AI Assistant, the model runtime and the AI tools (16-ai-assistant.md). Importing this
// registers the AI executors and, when one is configured, the local image-model runtime.
export * from "./ai/index.ts";
// Online media downloads and the network/info lookups (17-online-media-network-tools.md).
// Importing these registers the phase-17 executors.
export * from "./online-media/index.ts";
export * from "./network/index.ts";
