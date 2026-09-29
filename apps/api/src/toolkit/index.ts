// The five toolkit categories added in 21-roadmap-expansion.md: Security & Privacy, Finance & Math,
// Education & Reference, Calendar & Time, and Fun & Personal.
//
// Importing this module registers every executor with the registry, the same self-registration
// pattern every phase since 04 uses — the registry never imports these files.
import { registerExecutor } from "@onestop/tool-registry";

import {
  calendarEventExecutor,
  countdownPageExecutor,
  decisionMakerExecutor,
  flashcardMakerExecutor,
  typingSpeedTestExecutor,
  worldClockExecutor,
} from "./everyday.ts";
import {
  compoundInterestExecutor,
  currencyConverterExecutor,
  invoiceGeneratorExecutor,
  loanCalculatorExecutor,
  tipSplitterExecutor,
} from "./finance.ts";
import {
  breachCheckExecutor,
  dicewareExecutor,
  fileDecryptorExecutor,
  fileEncryptorExecutor,
  passwordStrengthMeterExecutor,
  totpGeneratorExecutor,
} from "./security.ts";
import { yearInOnestopExecutor } from "./wrapup.ts";

export {
  COMMON_PASSWORDS,
  DICEWARE_WORDS,
  ENCRYPT_MAGIC,
  HIBP_RANGE_URL,
  base32Decode,
  base32Encode,
  countInRange,
  decryptBytes,
  diceware,
  encryptBytes,
  hibpSplit,
  scorePassword,
  totp,
  type StrengthReport,
  type TotpAlgorithm,
} from "./security.ts";
export {
  RATE_URL,
  _clearRateCache,
  _seedRateCache,
  amortize,
  parseInvoiceLines,
  projectGrowth,
  type GrowthRow,
  type InvoiceLine,
  type LoanResult,
  type LoanRow,
} from "./finance.ts";
export { renderInvoiceDocx, renderInvoicePdf, type InvoiceData } from "./invoice.ts";
export {
  COMMON_ZONES,
  TYPING_PASSAGES,
  buildIcs,
  countdownHtml,
  flashcardHtml,
  foldIcsLine,
  formatInZone,
  icsEscape,
  makeTeams,
  parseFlashcards,
  scoreTyping,
  shuffled,
  zoneOffsetMinutes,
  type Flashcard,
  type IcsEvent,
} from "./everyday.ts";
export { summariseYear, type WrapUp, type WrapUpRun } from "./wrapup.ts";

/** Every tool these five categories own. */
export const TOOLKIT_EXECUTORS = [
  // Security & Privacy.
  ["password-strength-meter", passwordStrengthMeterExecutor],
  ["totp-code-generator", totpGeneratorExecutor],
  ["diceware-passphrase-generator", dicewareExecutor],
  ["file-encryptor", fileEncryptorExecutor],
  ["file-decryptor", fileDecryptorExecutor],
  ["breach-check", breachCheckExecutor],
  // Finance & Math.
  ["loan-calculator", loanCalculatorExecutor],
  ["compound-interest-calculator", compoundInterestExecutor],
  ["tip-splitter", tipSplitterExecutor],
  ["currency-converter", currencyConverterExecutor],
  ["invoice-generator", invoiceGeneratorExecutor],
  // Education & Reference.
  ["flashcard-maker", flashcardMakerExecutor],
  ["typing-speed-test", typingSpeedTestExecutor],
  // Calendar & Time.
  ["world-clock-converter", worldClockExecutor],
  ["calendar-event-generator", calendarEventExecutor],
  ["countdown-page-generator", countdownPageExecutor],
  // Fun & Personal.
  ["decision-maker", decisionMakerExecutor],
  ["year-in-onestop", yearInOnestopExecutor],
] as const;

for (const [id, executor] of TOOLKIT_EXECUTORS) registerExecutor(id, executor);
