// Public surface of the file-processing module (04-file-core.md).
// Importing this module also registers the server-side executors it owns, so anything that can
// run the pipeline automatically has them.
import { registerExecutor } from "@onestop/tool-registry";
import { FILE_METADATA_TOOL_ID, fileMetadataExecutor } from "./executors/file-metadata.ts";

export { loadFileCoreConfig } from "./config.ts";
export type { FileCoreConfig } from "./config.ts";

export {
  MAX_FILENAME_LENGTH,
  MIME_BY_EXTENSION,
  isSafeFileName,
  mimeTypeForExtension,
  resolveWithin,
  sanitizeFileName,
  sniffExtensions,
  validateOutputFile,
  validateUpload,
} from "./validate.ts";
export type { UploadCandidate, ValidateUploadOptions } from "./validate.ts";

export { createTempStore, getTempStore, isTempFileId, setTempStore } from "./tempStore.ts";
export type { CreateTempStoreOptions, PutTempFileInput, TempFile, TempStore } from "./tempStore.ts";

export {
  InvalidJobTransitionError,
  JobNotFoundError,
  canTransition,
  createInMemoryJobStore,
  getJobStore,
  setJobStore,
} from "./job.ts";
export type {
  CreateJobInput,
  Job,
  JobStatus,
  JobStore,
  ListJobsFilter,
  UpdateJobInput,
} from "./job.ts";

export {
  DEFAULT_EXECUTION_TIMEOUT_MS,
  FILE_DOWNLOAD_PATH,
  UnknownToolError,
  detectExecutionMode,
  runPipeline,
} from "./pipeline.ts";
export type {
  PipelineDeps,
  PipelineFileInput,
  PipelineOutcome,
  RunPipelineInput,
} from "./pipeline.ts";

export { fileMetadataExecutor } from "./executors/file-metadata.ts";

registerExecutor(FILE_METADATA_TOOL_ID, fileMetadataExecutor);
