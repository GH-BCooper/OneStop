// Profile picture upload (CLAUDE.md §5: no raw file binaries in Postgres).
//
// A profile picture is small once resized, so it is kept the same way phase 06 keeps a drawn
// signature: a strictly re-validated, re-encoded data URL in a text column, never the visitor's
// original bytes. The upload is never trusted - only what `sharp` decodes out of it is stored.
import sharp from "sharp";
import { sniffExtensions } from "../file-processing/validate.ts";
import { AuthError } from "./users.ts";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB in; the stored data URL ends up far smaller
const AVATAR_SIZE = 256;
const ACCEPTED = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

/**
 * Validates an avatar upload's bytes and returns a compact `data:image/webp;...` URL, resized and
 * re-encoded server-side. Throws `AuthError("INVALID_INPUT")` for anything that is not a real,
 * reasonably sized image.
 */
export async function processAvatarUpload(bytes: Uint8Array): Promise<string> {
  if (bytes.length === 0) {
    throw new AuthError("INVALID_INPUT", "Choose an image file.", "avatar");
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new AuthError("INVALID_INPUT", "That image is too large (max 8 MB).", "avatar");
  }
  const sniffed = sniffExtensions(bytes);
  if (!sniffed || !sniffed.some((ext) => ACCEPTED.has(ext))) {
    throw new AuthError(
      "INVALID_INPUT",
      "That doesn't look like a supported image (PNG, JPEG, WebP or GIF).",
      "avatar",
    );
  }
  try {
    const resized = await sharp(bytes)
      .rotate() // respects EXIF orientation before it is stripped
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
      .webp({ quality: 82 })
      .toBuffer();
    return `data:image/webp;base64,${resized.toString("base64")}`;
  } catch {
    throw new AuthError("INVALID_INPUT", "That image could not be read.", "avatar");
  }
}
