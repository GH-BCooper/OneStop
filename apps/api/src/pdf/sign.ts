// Sign PDF (Features 1.20) — a practical, free e-signature.
//
// The signature is drawn on the tool page, uploaded as a PNG/JPG next to the PDF, or typed. It is
// placed on the chosen page with an optional "Signed by … on …" caption. Optionally the result is
// also sealed with a *self-signed* certificate (PKCS#7 detached, SHA-256): that proves the file
// has not changed since signing, but it is not a trusted identity — there is no paid CA or
// notarisation service anywhere, and the summary says so.
import { generateKeyPairSync, createHash } from "node:crypto";
import {
  PDFArray,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  rgb,
  type PDFDocument,
  type PDFImage,
  type PDFPage,
} from "@cantoo/pdf-lib";
import { SignPdf } from "@signpdf/signpdf";
import { P12Signer } from "@signpdf/signer-p12";
import forge from "node-forge";
import type { Executor } from "@onestop/tool-registry";
import {
  loadPdf,
  optBool,
  optEnum,
  optNumber,
  optString,
  outputName,
  PDF_MIME,
} from "./document.ts";
import { runPdfTool, unsupported, PdfToolError } from "./errors.ts";
import { drawableText, embedUnicodeFont } from "./fonts.ts";
import { decodeImageDataUrl, embedImage, readMixedInputs } from "./inputs.ts";
import {
  anchorPoint,
  drawImageAt,
  drawTextCentered,
  visualFrame,
  type Anchor,
} from "./placement.ts";

export const SIGN_PDF_TOOL_ID = "sign-pdf";

const SOURCES = ["draw", "upload", "type"] as const;
const POSITIONS = [
  "bottom-right",
  "bottom-left",
  "bottom-center",
  "top-right",
  "top-left",
  "center",
] as const;
/** Room reserved for the PKCS#7 blob: a 2048-bit RSA signature plus one certificate fits easily. */
const SIGNATURE_BYTES = 8192;

function resolvePage(spec: string, pageCount: number): number {
  const s = spec.trim().toLowerCase();
  if (s === "" || s === "last") return pageCount;
  if (s === "first") return 1;
  if (!/^\d+$/.test(s)) throw unsupported('Enter a page number, "first" or "last".');
  const n = Number(s);
  if (n < 1 || n > pageCount) {
    throw unsupported(
      `This PDF has ${pageCount} page${pageCount === 1 ? "" : "s"}, so page ${n} does not exist.`,
    );
  }
  return n;
}

/** Renders a typed name as a signature image-equivalent: italic text on the page. */
async function typedSignature(doc: PDFDocument, name: string) {
  const font = await embedUnicodeFont(doc, "bold-italic");
  return { font, text: drawableText(font, name) };
}

export interface SelfSignedIdentity {
  p12: Buffer;
  passphrase: string;
  fingerprint: string;
}

/** A fresh RSA-2048 key and a self-signed X.509 certificate, wrapped as PKCS#12 for signing. */
export function createSelfSignedIdentity(commonName: string): SelfSignedIdentity {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = forge.pki.privateKeyFromPem(
    privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
  );
  const pub = forge.pki.publicKeyFromPem(
    publicKey.export({ type: "spki", format: "pem" }).toString(),
  );
  const cert = forge.pki.createCertificate();
  cert.publicKey = pub;
  cert.serialNumber = `01${forge.util.bytesToHex(forge.random.getBytesSync(15))}`;
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + 5 * 365 * 24 * 3600 * 1000);
  const attrs = [
    { name: "commonName", value: commonName.slice(0, 64) || "OneStop signer" },
    { name: "organizationName", value: "Self-signed with OneStop" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, nonRepudiation: true },
  ]);
  cert.sign(key, forge.md.sha256.create());
  const passphrase = forge.util.bytesToHex(forge.random.getBytesSync(16));
  const p12 = forge.pkcs12.toPkcs12Asn1(key, [cert], passphrase, { algorithm: "3des" });
  const der = forge.asn1.toDer(p12).getBytes();
  const fingerprint = createHash("sha256")
    .update(Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), "binary"))
    .digest("hex")
    .toUpperCase()
    .match(/.{2}/g)!
    .join(":");
  return { p12: Buffer.from(der, "binary"), passphrase, fingerprint };
}

/**
 * Adds an (invisible-widget) signature field whose value holds a ByteRange/Contents placeholder,
 * the structure @signpdf fills in. The visible signature is the drawn image, not the widget.
 */
function addSignaturePlaceholder(
  doc: PDFDocument,
  page: PDFPage,
  signer: string,
  reason: string,
): void {
  const ctx = doc.context;
  const byteRange = PDFArray.withContext(ctx);
  byteRange.push(PDFNumber.of(0));
  for (let i = 0; i < 3; i += 1) byteRange.push(PDFName.of("**********"));
  const sigDict = ctx.obj({
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    SubFilter: "adbe.pkcs7.detached",
    ByteRange: byteRange,
    Contents: PDFHexString.of("0".repeat(SIGNATURE_BYTES * 2)),
    Reason: PDFString.of(reason),
    Name: PDFString.of(signer),
    M: PDFString.fromDate(new Date()),
    Prop_Build: { App: { Name: "OneStop" } },
  });
  const sigRef = ctx.register(sigDict);
  const widget = ctx.obj({
    Type: "Annot",
    Subtype: "Widget",
    FT: "Sig",
    Rect: [0, 0, 0, 0],
    V: sigRef,
    T: PDFString.of(`Signature${Date.now() % 100000}`),
    F: 4,
    P: page.ref,
  });
  const widgetRef = ctx.register(widget);
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (annots) annots.push(widgetRef);
  else page.node.set(PDFName.of("Annots"), ctx.obj([widgetRef]));

  const form = doc.catalog.getOrCreateAcroForm();
  form.addField(widgetRef);
  form.dict.set(PDFName.of("SigFlags"), PDFNumber.of(3));
}

export const signPdfExecutor: Executor = async (input, options, ctx) =>
  runPdfTool(SIGN_PDF_TOOL_ID, async () => {
    const { pdfs, images } = await readMixedInputs(input, ctx);
    if (pdfs.length > 1) throw unsupported("Sign one PDF at a time.");
    const file = pdfs[0]!;
    const source = optEnum(options, "source", SOURCES, images.length > 0 ? "upload" : "draw");
    const signer = optString(options, "signerName").trim().slice(0, 100);
    const showCaption = optBool(options, "caption", true);
    const certify = optBool(options, "certify", false);
    const position = optEnum(options, "position", POSITIONS, "bottom-right") as Anchor;
    const width = optNumber(options, "width", 160, { min: 40, max: 500 });

    const doc = await loadPdf(file.bytes);
    const pageNumber = resolvePage(optString(options, "page", "last"), doc.getPageCount());
    const page = doc.getPage(pageNumber - 1);
    const frame = visualFrame(page);

    let image: PDFImage | null = null;
    let typed: Awaited<ReturnType<typeof typedSignature>> | null = null;
    if (source === "upload") {
      if (images.length === 0)
        throw unsupported("Upload a PNG or JPG of your signature together with the PDF.");
      image = await embedImage(doc, images[0]!);
    } else if (source === "draw") {
      const decoded = decodeImageDataUrl(optString(options, "signature"));
      if (!decoded) throw unsupported("Draw your signature in the box first.");
      image = await embedImage(doc, decoded);
    } else {
      if (signer === "") throw unsupported("Type your name to use it as the signature.");
      typed = await typedSignature(doc, signer);
    }

    const w = Math.min(width, frame.width - 24);
    const h = image ? (w * image.height) / image.width : Math.min(w / 4, 48);
    const captionSize = 8;
    const captionText = showCaption
      ? `${signer ? `Signed by ${signer}` : "Signed"} on ${new Date().toISOString().slice(0, 10)}`
      : "";
    const boxHeight = h + (captionText ? captionSize * 2 : 0);
    const { cx, cy } = anchorPoint(frame, position, w, boxHeight, 36);
    const top = cy + boxHeight / 2;

    if (image) {
      drawImageAt(page, frame, image, { x: cx - w / 2, y: top - h, width: w, height: h });
    } else if (typed) {
      const size = Math.min(
        h * 0.8,
        (h * 0.8 * w) / Math.max(1, typed.font.widthOfTextAtSize(typed.text, h * 0.8)),
      );
      drawTextCentered(page, frame, typed.text, {
        cx,
        cy: top - h / 2,
        font: typed.font,
        size,
        color: rgb(0.05, 0.1, 0.35),
      });
    }
    if (captionText) {
      const font = await embedUnicodeFont(doc);
      drawTextCentered(page, frame, drawableText(font, captionText), {
        cx,
        cy: top - h - captionSize,
        font,
        size: captionSize,
        color: rgb(0.3, 0.3, 0.3),
      });
    }

    let fingerprint: string | undefined;
    let bytes: Uint8Array;
    if (certify) {
      addSignaturePlaceholder(doc, page, signer || "OneStop signer", "Signed with OneStop");
      const unsigned = await doc.save({ useObjectStreams: false });
      const identity = createSelfSignedIdentity(signer || "OneStop signer");
      try {
        const signed = await new SignPdf().sign(
          Buffer.from(unsigned),
          new P12Signer(identity.p12, { passphrase: identity.passphrase }),
        );
        bytes = new Uint8Array(signed);
      } catch (err) {
        throw new PdfToolError(
          "FAILED",
          "The digital certificate could not be applied. Try again without it.",
          err,
        );
      }
      fingerprint = identity.fingerprint;
    } else {
      bytes = await doc.save({ useObjectStreams: true });
    }

    return {
      ok: true,
      output: {
        page: pageNumber,
        source,
        certified: certify,
        certificateSha256: fingerprint ?? null,
      },
      summary: certify
        ? `Signed page ${pageNumber} and sealed it with a self-signed certificate. Readers will show the seal as "unknown identity" — it proves the file is unchanged, not who you are.`
        : `Signed page ${pageNumber}.`,
      files: [{ name: outputName(file.ref.name, "signed"), mimeType: PDF_MIME, bytes }],
    };
  });
