// Network / Information utilities (17-online-media-network-tools.md, Features §13).
//
// Importing this module registers every executor with the tool registry, following the same
// pattern as phases 05-12: the registry never imports these files, they register themselves.
//
// Everything here reaches outside the machine except the User-Agent Lookup, which parses a string
// the user pasted and is marked `network: "none"` in the registry for that reason.
import { registerExecutor } from "@onestop/tool-registry";
import { NETWORK_EXECUTORS } from "./tools.ts";

export * from "./tools.ts";
export {
  MIME as NETWORK_MIME,
  OFFLINE_MESSAGE,
  failed as netFailed,
  jsonFile,
  looksOffline,
  offline as netOffline,
  outboundUserAgent,
  pace,
  rateLimit,
  reportText as netReportText,
  resetRateLimits,
  runNetTool,
  type RateLimit,
} from "./common.ts";
export {
  canonicalIpv6,
  classifyIp,
  isPubliclyRoutable,
  parseIp,
  parseIpv4,
  parseIpv6,
  reverseName,
  type IpClass,
  type IpVersion,
  type ParsedIp,
} from "./ipAddress.ts";
export {
  DEFAULT_MAX_BYTES,
  DEFAULT_TIMEOUT_MS,
  MAX_REDIRECTS,
  checkUrl,
  decodeBody,
  parseSafeUrl,
  resolveSafely,
  safeFetch,
  type SafeFetchOptions,
  type SafeResponse,
  type SafeUrl,
} from "./ssrf.ts";
export {
  DEFAULT_RECORD_TYPES,
  RECORD_TYPES,
  formatAnswer,
  lookupDns,
  normalizeHost,
  reverseLookup,
  type DnsAnswer,
  type DnsReport,
  type RecordType,
} from "./dns.ts";
export {
  geocode,
  geolocate,
  geolocateParsed,
  parseCoordinates,
  reverseGeocode,
  country as geoCountry,
  type GeoResult,
  type Place,
} from "./geo.ts";
export { mmdbStatus, resetMmdbCache, type CityResult } from "./mmdb.ts";
export {
  IANA_WHOIS,
  MAX_REFERRALS,
  parseWhois,
  referralFrom,
  setWhoisTransport,
  whois,
  type WhoisFields,
  type WhoisReport,
  type WhoisTransport,
} from "./whois.ts";
export {
  describeSite,
  inspectCertificate,
  lookupSite,
  readPageMeta,
  type CertificateInfo,
  type PageMeta,
  type SiteInfo,
} from "./siteInfo.ts";
export { COUNTRIES, GEOIP_BUILT_ON, type CountryRow } from "./data/countries.ts";

for (const [id, executor] of NETWORK_EXECUTORS) registerExecutor(id, executor);
