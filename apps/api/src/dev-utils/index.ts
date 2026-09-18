// Developer & file utilities (12-dev-utility-tools.md).
//
// Importing this module registers every executor with the tool registry, following the phase-04
// pattern: the registry never imports these files, they register themselves.
//
// Note on scope: the JSON and XML formatters and validators listed in §12.1-12.4 were built in
// phase 08 (they are the same tools as §4.13-4.16 and live in `apps/api/src/data/`), so this
// phase does not add a second copy. That is why there is no `validators.ts` here.
//
// The File Metadata Viewer (§14.7) is the same: phase 04 built it for real, so this phase only
// promotes it from "demo" to "available" and adds the Metadata Remover beside it.
import { registerExecutor } from "@onestop/tool-registry";

import { duplicateFileDetectorExecutor } from "./duplicateDetector.ts";
import {
  base64DecoderExecutor,
  base64EncoderExecutor,
  urlDecoderExecutor,
  urlEncoderExecutor,
} from "./encoders.ts";
import { metadataRemoverExecutor } from "./fileMeta.ts";
import { fileMergerExecutor, fileSplitterExecutor, fileTypeConverterExecutor } from "./fileOps.ts";
import {
  cssFormatterExecutor,
  htmlFormatterExecutor,
  javascriptFormatterExecutor,
} from "./formatters.ts";
import { passwordGeneratorExecutor, uuidGeneratorExecutor } from "./generators.ts";
import { checksumGeneratorExecutor, hashGeneratorExecutor } from "./hashing.ts";
import { markdownConverterExecutor, markdownToHtmlExecutor } from "./markdown.ts";
import { regexTesterExecutor } from "./regex.ts";
import { timestampConverterExecutor } from "./timestamps.ts";
import { userAgentViewerExecutor } from "./userAgent.ts";
import { fileCompressorExecutor, zipCreatorExecutor, zipExtractorExecutor } from "./zip.ts";

export {
  compactJs,
  formatSource,
  minifyCss,
  minifyHtml,
  scanCss,
  type FormatOptions,
  type Lang,
} from "./formatters.ts";
export {
  markdownToDocx,
  markdownToHtml,
  markdownToText,
  sanitizeHtml,
  type MarkdownOptions,
  type MarkdownTarget,
} from "./markdown.ts";
export {
  decodeBase64,
  decodeUrl,
  describeUrl,
  encodeBase64,
  encodeUrl,
  looksLikeText,
  type Base64Variant,
  type UrlMode,
} from "./encoders.ts";
export {
  AMBIGUOUS,
  CHARSETS,
  buildAlphabet,
  formatUuid,
  generatePassword,
  generateUuids,
  passwordEntropy,
  strengthLabel,
  uuidV7,
  type PasswordOptions,
  type UuidVersion,
} from "./generators.ts";
export {
  ALGORITHMS,
  ALGORITHM_LABELS,
  digestsMatch,
  hashBytes,
  hashText,
  hmacText,
  sumFileText,
  type Algorithm,
  type Digest,
  type FileChecksum,
} from "./hashing.ts";
export {
  parseTimestampInput,
  relativeTo,
  timestampViews,
  type TimestampUnit,
  type TimestampViews,
} from "./timestamps.ts";
export {
  MATCH_BUDGET_MS,
  MAX_SAMPLE_BYTES,
  compileRegex,
  screenPattern,
  testRegex,
  type RegexMatch,
  type RegexReport,
  type RegexSegment,
} from "./regex.ts";
export { describeUserAgent, parseUserAgent, type ParsedUserAgent } from "./userAgent.ts";
export {
  MAX_ENTRIES,
  MAX_EXTRACTED_BYTES,
  buildZip,
  readZip,
  safeEntryPath,
  type ExtractedEntry,
  type ZipBuildEntry,
} from "./zip.ts";
export {
  PART_SUFFIX,
  findRoute,
  joinInstructions,
  mergedName,
  naturalCompare,
  splitBytes,
  targetsFor,
  type ConversionRoute,
  type FilePart,
} from "./fileOps.ts";
export { removerRouteFor, type RemoverRoute } from "./fileMeta.ts";
export {
  findDuplicates,
  reportText,
  type DuplicateGroup,
  type DuplicateReport,
} from "./duplicateDetector.ts";
export { MIME as DEV_UTIL_MIME, safeStem, type UtilFile } from "./common.ts";

/** Every tool this phase owns, in the order the Features list gives them. */
export const DEV_UTIL_EXECUTORS = [
  ["html-formatter", htmlFormatterExecutor],
  ["css-formatter", cssFormatterExecutor],
  ["javascript-formatter", javascriptFormatterExecutor],
  ["markdown-converter", markdownConverterExecutor],
  ["markdown-to-html", markdownToHtmlExecutor],
  ["base64-encoder", base64EncoderExecutor],
  ["base64-decoder", base64DecoderExecutor],
  ["url-encoder", urlEncoderExecutor],
  ["url-decoder", urlDecoderExecutor],
  ["uuid-generator", uuidGeneratorExecutor],
  ["password-generator", passwordGeneratorExecutor],
  ["hash-generator", hashGeneratorExecutor],
  ["timestamp-converter", timestampConverterExecutor],
  ["regex-tester", regexTesterExecutor],
  ["user-agent-viewer", userAgentViewerExecutor],
  // File Utilities (Features §14).
  ["file-compressor", fileCompressorExecutor],
  ["zip-creator", zipCreatorExecutor],
  ["zip-extractor", zipExtractorExecutor],
  ["file-merger", fileMergerExecutor],
  ["file-splitter", fileSplitterExecutor],
  ["file-type-converter", fileTypeConverterExecutor],
  ["metadata-remover", metadataRemoverExecutor],
  ["checksum-generator", checksumGeneratorExecutor],
  ["duplicate-file-detector", duplicateFileDetectorExecutor],
] as const;

for (const [id, executor] of DEV_UTIL_EXECUTORS) registerExecutor(id, executor);
