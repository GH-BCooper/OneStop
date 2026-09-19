// An optional reader for the MaxMind DB (.mmdb) file format (17-online-media-network-tools.md).
//
// The bundled RIR tables in `geo.ts` always work and need nothing, but they only reach country
// level. An operator who wants city level can download the free GeoLite2 City database themselves
// and set GEOIP_MMDB to its path — still $0, still local, still offline, and never required. This
// file reads that format directly rather than adding a dependency for a feature most instances
// will not turn on.
//
// Format: https://maxmind.github.io/MaxMind-DB/ — a binary search tree over the address bits,
// then a section of typed records the leaves point into.
import { readFileSync, statSync } from "node:fs";
import type { ParsedIp } from "./ipAddress.ts";

const METADATA_MARKER = Buffer.from("\xAB\xCD\xEFMaxMind.com", "binary");
const DATA_SECTION_SEPARATOR = 16;

export interface CityResult {
  countryCode: string | null;
  city: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface Metadata {
  nodeCount: number;
  recordSize: number;
  ipVersion: number;
  databaseType: string;
  buildEpoch: number;
}

interface Database {
  buffer: Buffer;
  meta: Metadata;
  /** Where the record section starts. */
  dataStart: number;
}

export class MmdbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MmdbError";
  }
}

// ---- decoding ---------------------------------------------------------------------------------

interface Cursor {
  offset: number;
}

function decode(buffer: Buffer, dataStart: number, cursor: Cursor): unknown {
  const control = buffer[cursor.offset++]!;
  let type = control >> 5;
  if (type === 0) type = buffer[cursor.offset++]! + 7;

  if (type === 1) {
    // A pointer back to a record that has already been written once.
    const size = (control >> 3) & 0x3;
    const low = control & 0x7;
    let pointer: number;
    if (size === 0) {
      pointer = (low << 8) | buffer[cursor.offset]!;
      cursor.offset += 1;
    } else if (size === 1) {
      pointer = ((low << 16) | buffer.readUInt16BE(cursor.offset)) + 2048;
      cursor.offset += 2;
    } else if (size === 2) {
      pointer = ((low << 24) | buffer.readUIntBE(cursor.offset, 3)) + 526336;
      cursor.offset += 3;
    } else {
      pointer = buffer.readUInt32BE(cursor.offset);
      cursor.offset += 4;
    }
    return decode(buffer, dataStart, { offset: dataStart + pointer });
  }

  let size = control & 0x1f;
  if (size === 29) size = 29 + buffer[cursor.offset++]!;
  else if (size === 30) {
    size = 285 + buffer.readUInt16BE(cursor.offset);
    cursor.offset += 2;
  } else if (size === 31) {
    size = 65821 + buffer.readUIntBE(cursor.offset, 3);
    cursor.offset += 3;
  }

  const start = cursor.offset;
  switch (type) {
    case 2: {
      cursor.offset += size;
      return buffer.toString("utf8", start, start + size);
    }
    case 3: {
      cursor.offset += 8;
      return buffer.readDoubleBE(start);
    }
    case 4: {
      cursor.offset += size;
      return buffer.subarray(start, start + size);
    }
    case 5:
    case 6:
    case 9:
    case 10: {
      cursor.offset += size;
      let value = 0n;
      for (let i = 0; i < size; i++) value = (value << 8n) | BigInt(buffer[start + i]!);
      return size > 6 ? value : Number(value);
    }
    case 7: {
      const map: Record<string, unknown> = {};
      for (let i = 0; i < size; i++) {
        const key = decode(buffer, dataStart, cursor);
        map[String(key)] = decode(buffer, dataStart, cursor);
      }
      return map;
    }
    case 8: {
      cursor.offset += size;
      let value = 0;
      for (let i = 0; i < size; i++) value = (value << 8) | buffer[start + i]!;
      return size === 4 ? value | 0 : value;
    }
    case 11: {
      const list: unknown[] = [];
      for (let i = 0; i < size; i++) list.push(decode(buffer, dataStart, cursor));
      return list;
    }
    case 14:
      return size === 1;
    case 15: {
      cursor.offset += size;
      return size === 4 ? buffer.readFloatBE(start) : 0;
    }
    default:
      throw new MmdbError(`unsupported MaxMind DB field type ${type}`);
  }
}

// ---- loading ----------------------------------------------------------------------------------

function readMetadata(buffer: Buffer): { meta: Metadata; dataStart: number } {
  const marker = buffer.lastIndexOf(METADATA_MARKER);
  if (marker < 0) throw new MmdbError("this file is not a MaxMind DB");
  // Pointers inside the metadata are relative to the start of the metadata section, not to the
  // record section the tree uses.
  const metaStart = marker + METADATA_MARKER.length;
  const raw = decode(buffer, metaStart, { offset: metaStart }) as Record<string, unknown>;
  const meta: Metadata = {
    nodeCount: Number(raw.node_count ?? 0),
    recordSize: Number(raw.record_size ?? 0),
    ipVersion: Number(raw.ip_version ?? 4),
    databaseType: String(raw.database_type ?? "unknown"),
    buildEpoch: Number(raw.build_epoch ?? 0),
  };
  if (![24, 28, 32].includes(meta.recordSize) || meta.nodeCount <= 0) {
    throw new MmdbError("this MaxMind DB has an unreadable header");
  }
  const dataStart = (meta.nodeCount * meta.recordSize * 2) / 8 + DATA_SECTION_SEPARATOR;
  return { meta, dataStart };
}

function readNode(db: Database, node: number, bit: 0 | 1): number {
  const { buffer, meta } = db;
  const width = meta.recordSize;
  const base = (node * width * 2) / 8;
  if (width === 24) return buffer.readUIntBE(base + bit * 3, 3);
  if (width === 32) return buffer.readUInt32BE(base + bit * 4);
  // 28-bit records share a middle byte: the high nibble belongs to the left record.
  const middle = buffer[base + 3]!;
  return bit === 0
    ? ((middle >> 4) << 24) | buffer.readUIntBE(base, 3)
    : ((middle & 0x0f) << 24) | buffer.readUIntBE(base + 4, 3);
}

let cached: { path: string; mtimeMs: number; db: Database | null } | null = null;

/** The configured database, or null when GEOIP_MMDB is unset or the file is unusable. */
function openDatabase(): Database | null {
  const configured = process.env.GEOIP_MMDB;
  if (!configured) return null;
  let mtimeMs: number;
  try {
    mtimeMs = statSync(configured).mtimeMs;
  } catch {
    if (cached?.path !== configured) {
      console.error(`[network:geo] GEOIP_MMDB points at a file that cannot be read: ${configured}`);
    }
    cached = { path: configured, mtimeMs: 0, db: null };
    return null;
  }
  if (cached && cached.path === configured && cached.mtimeMs === mtimeMs) return cached.db;

  let db: Database | null;
  try {
    const buffer = readFileSync(configured);
    const { meta, dataStart } = readMetadata(buffer);
    db = { buffer, meta, dataStart };
  } catch (err) {
    console.error("[network:geo] GEOIP_MMDB could not be read", err);
    db = null;
  }
  cached = { path: configured, mtimeMs, db };
  return db;
}

/** Tests and the status page use this to forget a database between cases. */
export function resetMmdbCache(): void {
  cached = null;
}

export function mmdbStatus(): { configured: boolean; usable: boolean; type: string | null } {
  const configured = Boolean(process.env.GEOIP_MMDB);
  const db = openDatabase();
  return { configured, usable: db !== null, type: db?.meta.databaseType ?? null };
}

// ---- lookup -----------------------------------------------------------------------------------

function bitsOf(ip: ParsedIp, ipVersion: number): { value: bigint; length: number } {
  // An IPv4 address in an IPv6 tree is searched as ::ffff:a.b.c.d.
  if (ip.version === 4 && ipVersion === 6) {
    return { value: (0xffffn << 32n) | ip.value, length: 128 };
  }
  return ip.version === 4 ? { value: ip.value, length: 32 } : { value: ip.value, length: 128 };
}

function names(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const map = (value as { names?: Record<string, string> }).names;
  return map?.en ?? Object.values(map ?? {})[0] ?? null;
}

/** The city record for an address, or null when the database has nothing for it. */
export function lookupCity(ip: ParsedIp): CityResult | null {
  const db = openDatabase();
  if (!db) return null;
  if (ip.version === 6 && db.meta.ipVersion === 4) return null;

  const { value, length } = bitsOf(ip, db.meta.ipVersion);
  let node = 0;
  for (let i = 0; i < length; i++) {
    if (node >= db.meta.nodeCount) break;
    const bit = Number((value >> BigInt(length - 1 - i)) & 1n) as 0 | 1;
    node = readNode(db, node, bit);
  }
  // nodeCount exactly means "no record here"; anything above it is a record offset.
  if (node <= db.meta.nodeCount) return null;

  const offset = node - db.meta.nodeCount - DATA_SECTION_SEPARATOR + db.dataStart;
  const record = decode(db.buffer, db.dataStart, { offset }) as Record<string, unknown>;
  const location = record.location as { latitude?: number; longitude?: number } | undefined;
  const subdivisions = Array.isArray(record.subdivisions) ? record.subdivisions : [];
  const countryCode =
    (record.country as { iso_code?: string } | undefined)?.iso_code ??
    (record.registered_country as { iso_code?: string } | undefined)?.iso_code ??
    null;

  return {
    countryCode: countryCode ? countryCode.toUpperCase() : null,
    city: names(record.city),
    region: names(subdivisions[0]) ?? names(record.continent),
    latitude: typeof location?.latitude === "number" ? location.latitude : null,
    longitude: typeof location?.longitude === "number" ? location.longitude : null,
  };
}
