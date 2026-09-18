// The document title, for naming converted output (HTML <title>, Word/PowerPoint properties).
import { PDFDocument } from "@cantoo/pdf-lib";

export async function readTitle(bytes: Uint8Array): Promise<string | undefined> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return doc.getTitle()?.trim() || undefined;
  } catch {
    return undefined;
  }
}
