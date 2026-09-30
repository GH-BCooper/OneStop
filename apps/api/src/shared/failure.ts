// What to tell someone when a tool throws something nobody planned for.
//
// Every tool family has one catch-all that turns an unexpected throw into a user-facing result. The
// old wording - "could not be processed. Please try again." - was right for a hiccup and wrong for the
// commonest cause: a file that is damaged, cut short or not really what its name says. Retrying that
// never helps, so the message sent people round in circles. The libraries OneStop uses (sharp/libvips,
// pdf-lib, jszip, exceljs, mammoth, tesseract, FFmpeg) each complain about a bad file in their own
// words; this recognises those words so the family can say "this file looks damaged" instead.
const DAMAGED_INPUT =
  /corrupt|damaged|truncat|invalid or unsupported|no end header|unsupported zip|premature end|unexpected end|end of (central directory|file|data|stream)|end-of-central-directory|invalid (data|zip|pdf|jpeg|png|header|xref|file|format|signature|image|stream)|unsupported (image )?format|not a (valid )?(zip|pdf|image|word|excel)|bad seek|input buffer|vips|no pdf header|failed to parse|moov atom|can'?t find end|central directory|unknown (file )?format|malformed|xref|flate|inflate|bad (header|magic|signature)|pixel limit|error attempting to read image|unrecognized (file|image)/i;

export function looksLikeDamagedInput(err: unknown): boolean {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return DAMAGED_INPUT.test(text);
}

/** "This PDF could not be read…" - for a file the tool could not open. */
export function damagedInputMessage(what: string): string {
  return `This ${what} could not be read. It may be damaged or incomplete - try another copy of the file.`;
}

/**
 * The last resort, for a throw that is not obviously the file's fault. It says what to do in both
 * cases instead of only asking for a retry.
 */
export function unexpectedFailureMessage(what: string): string {
  return `Something went wrong while processing this ${what}. If it opens fine elsewhere, try once more; if it keeps failing, it may use a feature OneStop can't handle yet.`;
}
