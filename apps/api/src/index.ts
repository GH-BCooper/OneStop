export { PYTHON_PROCESSORS_DIR, PythonBridgeError, runPython } from "./python-bridge.ts";
export type { PythonBridgeErrorCode, RunPythonOptions } from "./python-bridge.ts";
export * from "./file-processing/index.ts";
// Importing the PDF module registers the phase-05 and phase-06 executors.
export * from "./pdf/index.ts";
// The shared Office ⇄ PDF interface (06-pdf-tools-advanced.md), reused by phases 07 and 08.
export * from "./shared/office-convert.ts";
// Importing the documents module registers the phase-07 Word & PowerPoint executors.
export * from "./documents/index.ts";
