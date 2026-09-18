// The static QR tools (11-qr-tools.md): generator, scanner, the per-content-type generators and
// QR Code Customization. Every one of them is fully offline - a QR code is made of arithmetic,
// not of a web service.
import type { ExecContext, ExecResult, FileRef } from "@onestop/types";
import type { Executor } from "@onestop/tool-registry";
import { decodeQrImage } from "./decode.ts";
import {
  buildEmail,
  buildPhone,
  buildSms,
  buildUrl,
  buildVCard,
  buildWifi,
  type WifiSecurity,
} from "./formats.ts";
import {
  mimeForName,
  oneFile,
  optBool,
  optEnum,
  optString,
  qrResult,
  runQrTool,
  textInput,
  toDataUrl,
  unsupported,
} from "./common.ts";
import { hostedQrCode } from "./dynamic.ts";

/** Generic generator: whatever is typed is encoded as-is, bar a friendly nudge for bare links. */
export const qrGeneratorExecutor: Executor = (input, options) =>
  runQrTool("qr-code-generator", async () => {
    const text = textInput(input, "the text or link for the QR code");
    // "example.com" on its own is almost always meant as a link; anything else is left untouched.
    const looksLikeBareDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(text.trim());
    const content = looksLikeBareDomain ? buildUrl(text) : text;
    return qrResult(content, options, "qr-code", {
      ...(looksLikeBareDomain
        ? { note: "Encoded as a link, so a phone will offer to open it." }
        : {}),
    });
  });

export const urlToQrExecutor: Executor = (input, options) =>
  runQrTool("url-to-qr", async () => {
    const url = buildUrl(textInput(input, "a link"));
    return qrResult(url, options, "link-qr");
  });

export const textToQrExecutor: Executor = (input, options) =>
  runQrTool("text-to-qr", async () => qrResult(textInput(input, "some text"), options, "text-qr"));

export const contactToQrExecutor: Executor = (input, options) =>
  runQrTool("contact-to-qr", async () => {
    const vcard = buildVCard({
      name: textInput(input, "the contact's name"),
      organisation: optString(options, "organisation"),
      title: optString(options, "jobTitle"),
      phone: optString(options, "phone"),
      email: optString(options, "email"),
      website: optString(options, "website"),
      address: optString(options, "address"),
      note: optString(options, "note"),
    });
    return qrResult(vcard, options, "contact-qr", {
      note: "Scanning it offers to save the contact.",
    });
  });

export const emailToQrExecutor: Executor = (input, options) =>
  runQrTool("email-to-qr", async () => {
    const mailto = buildEmail({
      to: textInput(input, "an email address"),
      subject: optString(options, "subject"),
      body: optString(options, "body"),
    });
    return qrResult(mailto, options, "email-qr", {
      note: "Scanning it opens a new email, ready to send.",
    });
  });

export const phoneToQrExecutor: Executor = (input, options) =>
  runQrTool("phone-to-qr", async () => {
    const number = textInput(input, "a phone number");
    const action = optEnum(options, "action", ["call", "sms"] as const, "call");
    const payload =
      action === "sms" ? buildSms(number, optString(options, "message")) : buildPhone(number);
    return qrResult(payload, options, action === "sms" ? "sms-qr" : "phone-qr", {
      note:
        action === "sms"
          ? "Scanning it starts a text message."
          : "Scanning it offers to dial the number.",
    });
  });

export const wifiToQrExecutor: Executor = (input, options) =>
  runQrTool("wifi-to-qr", async () => {
    const security = optEnum<WifiSecurity>(options, "security", ["WPA", "WEP", "nopass"], "WPA");
    const payload = buildWifi({
      ssid: textInput(input, "the network name (SSID)"),
      password: optString(options, "password"),
      security,
      hidden: optBool(options, "hidden", false),
    });
    return qrResult(payload, options, "wifi-qr", {
      output: { security, passwordIncluded: security !== "nopass" },
      note: "Scanning it joins the network. The password is in the code, so share it carefully.",
    });
  });

export const qrCustomizationExecutor: Executor = (input, options) =>
  runQrTool("qr-code-customization", async () => {
    const text = textInput(input, "the text or link for the QR code");
    const logo = optString(options, "logo");
    return qrResult(text, options, "custom-qr", {
      output: {
        dotShape: optString(options, "moduleShape", "square"),
        cornerShape: optString(options, "eyeShape", "square"),
        logo: logo !== "",
      },
      ...(logo !== ""
        ? { note: "Error correction was raised so the logo cannot stop the code scanning." }
        : {}),
    });
  });

// ---- file payloads ----------------------------------------------------------------------------

/**
 * A QR code holds about 2 KB at best, so a file only fits inside one when it is tiny. "auto"
 * embeds it when it fits and otherwise puts it on a hosted OneStop page the code points at -
 * which is the only honest way to make "Image -> QR" and "Audio -> QR" work for real files.
 */
async function fileQr(
  toolId: string,
  kind: "image" | "audio",
  input: FileRef[] | string | null,
  options: Record<string, unknown>,
  ctx: ExecContext | undefined,
): Promise<ExecResult> {
  const ref = oneFile(input);
  if (!ctx) throw unsupported("This tool needs a file.");
  const bytes = await ctx.readFile(ref);
  const mimeType = mimeForName(ref.name, kind === "image" ? "image/png" : "audio/mpeg");
  const mode = optEnum(options, "mode", ["auto", "embed", "link"] as const, "auto");
  const dataUrl = toDataUrl(bytes, mimeType);
  /** Version 40 at error correction L tops out at 2,953 bytes. */
  const fitsInACode = dataUrl.length <= 2_900;

  if (mode === "embed" || (mode === "auto" && fitsInACode)) {
    if (!fitsInACode) {
      throw unsupported(
        `This ${kind} file is ${Math.round(bytes.length / 1024)} KB, far more than the ~2 KB a QR code can hold. Choose "A hosted OneStop page" instead.`,
      );
    }
    return qrResult(dataUrl, options, `${kind}-qr`, {
      output: { mode: "embedded", fileName: ref.name, bytes: bytes.length },
      note: "The file is inside the code itself, so it works with no server at all.",
    });
  }

  const title = optString(options, "pageTitle") || ref.name;
  return hostedQrCode(toolId, options, {
    title,
    page: {
      title,
      blocks: [
        {
          type: kind,
          text: ref.name,
          data: dataUrl,
          fileName: ref.name,
          size: dataUrl.length,
        },
      ],
    },
    note: `The ${kind} is hosted on a OneStop page and the code points at it.`,
  });
}

export const imageToQrExecutor: Executor = (input, options, ctx) =>
  runQrTool("image-to-qr", () => fileQr("image-to-qr", "image", input, options, ctx));

export const audioToQrExecutor: Executor = (input, options, ctx) =>
  runQrTool("audio-to-qr", () => fileQr("audio-to-qr", "audio", input, options, ctx));

// ---- scanner ------------------------------------------------------------------------------------

/**
 * Reads a QR code out of an uploaded image. The camera path lives in the browser
 * (`apps/web/src/components/qr/QRScanner.tsx`) and never uploads anything.
 */
export const qrScannerExecutor: Executor = (input, options, ctx) =>
  runQrTool("qr-code-scanner", async () => {
    const ref = oneFile(input);
    if (!ctx) throw unsupported("Choose an image of a QR code.");
    const bytes = await ctx.readFile(ref);
    const found = await decodeQrImage(bytes);
    if (!found) {
      return {
        ok: false,
        code: "UNSUPPORTED_INPUT",
        message:
          "No QR code was found in this image. Try a sharper, straighter photo with the whole code in frame.",
      };
    }
    const showRaw = optBool(options, "showRaw", false);
    return {
      ok: true,
      output: {
        kind: found.kind,
        describes: found.label,
        fields: found.fields,
        ...(showRaw || Object.keys(found.fields).length === 0 ? { raw: found.text } : {}),
        readAs: found.variant,
      },
      summary: `Read a QR code from ${ref.name}: ${found.label}.`,
    };
  });
