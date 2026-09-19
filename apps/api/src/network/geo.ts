// Geolocation (17-online-media-network-tools.md).
//
// Two different problems, two different free answers:
//
// * IP -> country uses the tables in `data/`, built by `scripts/build-geoip.mjs` from the five
//   RIRs' own public delegation statistics. No account, no key, no rate limit, no network call —
//   which is exactly what the build file asks for ("a local GeoLite2 database ... rather than a
//   paid geolocation API, to avoid both cost and rate-limit fragility"). Country level is the
//   honest ceiling of that data and the tools say so rather than inventing a city.
//
//   An operator who wants city level can point GEOIP_MMDB at a GeoLite2 City database they
//   downloaded themselves; `mmdb.ts` reads it. That stays opt-in and local: still $0, still
//   offline, never required.
//
// * Place name <-> coordinates uses Nominatim (OpenStreetMap), the standard free geocoder. It
//   needs no key, it asks for a real User-Agent and at most one request a second, and both are
//   honoured here. NOMINATIM_URL points it at a self-hosted instance instead.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COUNTRIES, GEOIP_BUILT_ON, type CountryRow } from "./data/countries.ts";
import { classifyIp, parseIp, type ParsedIp } from "./ipAddress.ts";
import { failed, offline, outboundUserAgent, pace, unsupported } from "./common.ts";
import { lookupCity, type CityResult } from "./mmdb.ts";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");

interface Tables {
  v4: Buffer;
  v6: Buffer;
}

let tables: Tables | null = null;

function load(): Tables {
  if (!tables) {
    tables = {
      v4: readFileSync(path.join(DATA_DIR, "ipv4-country.bin")),
      v6: readFileSync(path.join(DATA_DIR, "ipv6-country.bin")),
    };
  }
  return tables;
}

const BY_CC = new Map(COUNTRIES.map((c) => [c.cc, c]));

export function country(cc: string): CountryRow | undefined {
  return BY_CC.get(cc.toUpperCase());
}

/** Binary search over the generated table. Rows are sorted and never overlap. */
function searchV4(buffer: Buffer, value: number): number | null {
  let lo = 0;
  let hi = buffer.length / 10 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const start = buffer.readUInt32LE(mid * 10);
    const end = buffer.readUInt32LE(mid * 10 + 4);
    if (value < start) hi = mid - 1;
    else if (value > end) lo = mid + 1;
    else return buffer.readUInt16LE(mid * 10 + 8);
  }
  return null;
}

function searchV6(buffer: Buffer, value: bigint): number | null {
  let lo = 0;
  let hi = buffer.length / 18 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const start = buffer.readBigUInt64LE(mid * 18);
    const end = buffer.readBigUInt64LE(mid * 18 + 8);
    if (value < start) hi = mid - 1;
    else if (value > end) lo = mid + 1;
    else return buffer.readUInt16LE(mid * 18 + 16);
  }
  return null;
}

export interface GeoResult {
  ip: string;
  country: CountryRow | null;
  city: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  /** How precise the answer is, so the UI never implies more than the data supports. */
  accuracy: "country" | "city" | "none";
  source: "rir-delegations" | "local-mmdb" | "none";
  /** The date the bundled tables were generated. */
  dataDate: string;
  note: string;
}

export function geolocate(text: string): GeoResult {
  const ip = parseIp(text);
  if (!ip) throw unsupported("That is not a valid IP address. Try something like 8.8.8.8.");
  return geolocateParsed(ip);
}

export function geolocateParsed(ip: ParsedIp): GeoResult {
  const base = {
    ip: ip.text,
    dataDate: GEOIP_BUILT_ON,
  };
  const cls = classifyIp(ip);
  if (!cls.routable) {
    return {
      ...base,
      country: null,
      city: null,
      region: null,
      latitude: null,
      longitude: null,
      accuracy: "none",
      source: "none",
      note: `This is ${cls.description}, so it has no location on the public Internet.`,
    };
  }

  // A local GeoLite2 database, when the operator has installed one, is strictly better.
  let city: CityResult | null = null;
  try {
    city = lookupCity(ip);
  } catch (err) {
    console.error("[network:geo] the local GeoIP database could not be read", err);
  }
  if (city) {
    const row = city.countryCode ? (country(city.countryCode) ?? null) : null;
    return {
      ...base,
      country: row,
      city: city.city,
      region: city.region,
      latitude: city.latitude,
      longitude: city.longitude,
      accuracy: city.city ? "city" : "country",
      source: "local-mmdb",
      note: "From the GeoIP database installed on this machine. City-level results are approximate — they place the network, not the person.",
    };
  }

  const table = load();
  const index = ip.version === 4 ? searchV4(table.v4, Number(ip.value)) : searchV6(table.v6, ip.hi);
  const row = index === null ? null : (COUNTRIES[index] ?? null);
  if (!row) {
    return {
      ...base,
      country: null,
      city: null,
      region: null,
      latitude: null,
      longitude: null,
      accuracy: "none",
      source: "none",
      note: "This address is not in any registry allocation, so no country can be given for it.",
    };
  }
  return {
    ...base,
    country: row,
    city: null,
    region: row.region || null,
    latitude: row.lat,
    longitude: row.lon,
    accuracy: "country",
    source: "rir-delegations",
    note: "Country level only, from the registries' own allocation records. The coordinates are the middle of the country, not a real position. For city-level results, install a GeoLite2 database and set GEOIP_MMDB.",
  };
}

// ---- Nominatim (place names) -------------------------------------------------------------------

export interface Place {
  displayName: string;
  latitude: number;
  longitude: number;
  type: string | null;
  countryCode: string | null;
  address: Record<string, string>;
  boundingBox: [number, number, number, number] | null;
  osm: string | null;
}

interface NominatimRow {
  display_name?: string;
  lat?: string;
  lon?: string;
  type?: string;
  class?: string;
  osm_type?: string;
  osm_id?: number;
  boundingbox?: string[];
  address?: Record<string, string>;
  error?: string;
}

function nominatimBase(): string {
  return (process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org").replace(/\/+$/, "");
}

async function nominatim(pathname: string, params: Record<string, string>): Promise<unknown> {
  // Nominatim's usage policy: an identifying User-Agent and at most one request a second.
  await pace("nominatim", 1100);
  const url = new URL(`${nominatimBase()}${pathname}`);
  for (const [key, value] of Object.entries({ ...params, format: "jsonv2" })) {
    url.searchParams.set(key, value);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  timer.unref?.();
  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": outboundUserAgent(), accept: "application/json" },
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw failed("The place lookup took too long to answer. Try again in a moment.");
    }
    throw offline(err);
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 429 || response.status === 403) {
    throw failed(
      "The free map service is busy or has blocked this instance for now. Wait a minute and try again.",
    );
  }
  if (!response.ok) {
    throw failed("The place lookup did not work. Try again in a moment.", response.status);
  }
  try {
    return await response.json();
  } catch (err) {
    throw failed("The place lookup sent back something unreadable. Try again.", err);
  }
}

function toPlace(row: NominatimRow): Place | null {
  const latitude = Number(row.lat);
  const longitude = Number(row.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const box = row.boundingbox?.map(Number);
  return {
    displayName: row.display_name ?? "",
    latitude,
    longitude,
    type: row.type ?? row.class ?? null,
    countryCode: row.address?.country_code?.toUpperCase() ?? null,
    address: row.address ?? {},
    boundingBox:
      box && box.length === 4 && box.every(Number.isFinite)
        ? [box[0]!, box[1]!, box[2]!, box[3]!]
        : null,
    osm: row.osm_type && row.osm_id ? `${row.osm_type}/${row.osm_id}` : null,
  };
}

/** Place or address -> coordinates. */
export async function geocode(query: string, limit = 5): Promise<Place[]> {
  const rows = (await nominatim("/search", {
    q: query,
    limit: String(Math.min(Math.max(limit, 1), 10)),
    addressdetails: "1",
  })) as NominatimRow[];
  if (!Array.isArray(rows)) throw failed("The place lookup sent back something unreadable.");
  return rows.map(toPlace).filter((p): p is Place => p !== null);
}

/** Coordinates -> place name. */
export async function reverseGeocode(latitude: number, longitude: number): Promise<Place | null> {
  const row = (await nominatim("/reverse", {
    lat: String(latitude),
    lon: String(longitude),
    addressdetails: "1",
    zoom: "18",
  })) as NominatimRow;
  if (!row || row.error) return null;
  return toPlace(row);
}

/**
 * Accepts the forms people actually paste: "48.8584, 2.2945", "48.8584 2.2945",
 * "48°51'29.6\"N 2°17'40.2\"E" and "N 48.8584, E 2.2945".
 */
export function parseCoordinates(text: string): { latitude: number; longitude: number } | null {
  const clean = text.trim().replace(/\s+/g, " ");

  const dms =
    /^\s*(\d{1,3})[°:\s]\s*(\d{1,2})['′:\s]\s*([\d.]+)\s*["″]?\s*([NSns])\s*[, ]\s*(\d{1,3})[°:\s]\s*(\d{1,2})['′:\s]\s*([\d.]+)\s*["″]?\s*([EWew])\s*$/.exec(
      clean,
    );
  if (dms) {
    const lat =
      (Number(dms[1]) + Number(dms[2]) / 60 + Number(dms[3]) / 3600) *
      (dms[4]!.toUpperCase() === "S" ? -1 : 1);
    const lon =
      (Number(dms[5]) + Number(dms[6]) / 60 + Number(dms[7]) / 3600) *
      (dms[8]!.toUpperCase() === "W" ? -1 : 1);
    return inRange(lat, lon);
  }

  const signed =
    /^\s*([NSns]?)\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([NSns]?)\s*[, ]\s*([EWew]?)\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EWew]?)\s*$/.exec(
      clean,
    );
  if (signed) {
    const ns = (signed[1] || signed[3] || "").toUpperCase();
    const ew = (signed[4] || signed[6] || "").toUpperCase();
    const lat = Number(signed[2]) * (ns === "S" ? -1 : 1);
    const lon = Number(signed[5]) * (ew === "W" ? -1 : 1);
    return inRange(lat, lon);
  }
  return null;
}

function inRange(
  latitude: number,
  longitude: number,
): { latitude: number; longitude: number } | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}
