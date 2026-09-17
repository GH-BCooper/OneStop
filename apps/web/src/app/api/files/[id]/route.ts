// GET /api/files/:id — downloads a result file from the temp store.
// DELETE /api/files/:id — removes it early ("delete temporary data" in master plan §14).
//
// Ids are random UUIDs issued by the store, so nothing user-supplied is ever turned into a path.
// Anything past its retention window is already gone, and a miss is a plain 404.
import { getTempStore, isTempFileId } from "@onestop/api";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RFC 5987 filename, so non-ASCII names survive the round trip. */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function notFound() {
  return NextResponse.json(
    { ok: false, error: { code: "NOT_FOUND", message: "This file is no longer available." } },
    { status: 404 },
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isTempFileId(id)) return notFound();

  const store = getTempStore();
  const record = await store.get(id);
  if (!record) return notFound();

  let bytes: Uint8Array;
  try {
    bytes = await store.read(id);
  } catch (err) {
    console.error(`[api/files] could not read ${id}`, err);
    return notFound();
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": record.mimeType,
      "content-length": String(record.size),
      "content-disposition": contentDisposition(record.name),
      "cache-control": "no-store",
      // Downloads are raw user content: never let a browser sniff or run them.
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
    },
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isTempFileId(id)) return notFound();
  const deleted = await getTempStore().delete(id);
  return NextResponse.json({ ok: true, deleted }, { status: 200 });
}
