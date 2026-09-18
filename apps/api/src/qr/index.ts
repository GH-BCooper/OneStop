// QR tools (11-qr-tools.md).
//
// Importing this module registers every executor with the tool registry, following the phase-04
// pattern: the registry never imports these files, they register themselves.
import { registerExecutor } from "@onestop/tool-registry";

import { qrAnalyticsExecutor } from "./analytics.ts";
import { contentPageExecutor, dynamicQrExecutor, landingPageExecutor } from "./dynamic.ts";
import {
  audioToQrExecutor,
  contactToQrExecutor,
  emailToQrExecutor,
  imageToQrExecutor,
  phoneToQrExecutor,
  qrCustomizationExecutor,
  qrGeneratorExecutor,
  qrScannerExecutor,
  textToQrExecutor,
  urlToQrExecutor,
  wifiToQrExecutor,
} from "./tools.ts";

export {
  buildEmail,
  buildGeo,
  buildPhone,
  buildSms,
  buildUrl,
  buildVCard,
  buildWifi,
  parsePayload,
  normalisePhone,
  type ContactFields,
  type ParsedPayload,
  type PayloadKind,
  type WifiFields,
  type WifiSecurity,
} from "./formats.ts";
export {
  buildMatrix,
  contrastRatio,
  eccForStyle,
  renderPng,
  renderQr,
  renderSvg,
  resolveStyle,
  DEFAULT_STYLE,
  QR_MIME,
  type Ecc,
  type QrFormat,
  type QrMatrix,
  type QrStyle,
  type RenderedQr,
} from "./generate.ts";
export { decodeQrImage, requireQrImage, type DecodedQr } from "./decode.ts";
export {
  appBaseUrl,
  getQrStore,
  isQrLinkId,
  setQrStore,
  shortUrlFor,
  validatePage,
  type CreateQrLinkInput,
  type QrLink,
  type QrPage,
  type QrPageBlock,
  type QrScan,
  type QrStore,
  type UpdateQrLinkInput,
} from "./store.ts";
export { hostedQrCode, resolveQrLink, type ResolvedQr } from "./dynamic.ts";
export { qrAnalytics, scansByDay, statsFor, type QrStats } from "./analytics.ts";

/** Every tool this phase owns, in the order the Features list gives them. */
export const QR_EXECUTORS = [
  ["qr-code-generator", qrGeneratorExecutor],
  ["qr-code-scanner", qrScannerExecutor],
  ["url-to-qr", urlToQrExecutor],
  ["text-to-qr", textToQrExecutor],
  ["image-to-qr", imageToQrExecutor],
  ["audio-to-qr", audioToQrExecutor],
  ["contact-to-qr", contactToQrExecutor],
  ["email-to-qr", emailToQrExecutor],
  ["phone-to-qr", phoneToQrExecutor],
  ["wifi-to-qr", wifiToQrExecutor],
  ["dynamic-qr-code", dynamicQrExecutor],
  ["custom-qr-landing-page", landingPageExecutor],
  ["qr-code-customization", qrCustomizationExecutor],
  ["qr-code-analytics", qrAnalyticsExecutor],
  ["qr-content-page", contentPageExecutor],
] as const;

for (const [id, executor] of QR_EXECUTORS) registerExecutor(id, executor);
