import { defineCategory } from "../define";

// Features §12 (Developer), §13 (Network) and §14 (File Utilities). JSON/XML formatters and
// validators (§12.1–12.4) live in data.ts; ZIP, file metadata and checksum tools listed in both
// §12 and §14 have one entry each here.
export const devTools = defineCategory("dev-utility", { phase: "12", sub: "Developer / Utility" }, [
  { src: ["12.5"], name: "HTML Formatter", in: ["html", "text"], out: ["html"], kw: ["beautify", "pretty print", "indent", "minify"], desc: "Pretty-print or minify HTML." },
  { src: ["12.6"], name: "CSS Formatter", in: ["css", "text"], out: ["css"], kw: ["beautify", "pretty print", "minify", "stylesheet"], desc: "Pretty-print or minify CSS." },
  { src: ["12.7"], name: "JavaScript Formatter", in: ["js", "text"], out: ["js"], kw: ["js", "beautify", "pretty print", "minify"], desc: "Pretty-print or minify JavaScript." },
  { src: ["12.8"], name: "Markdown Converter", in: ["md", "text"], out: ["html", "txt", "docx"], kw: ["md", "convert", "markdown"], desc: "Convert Markdown to HTML, plain text or Word." },
  { src: ["12.9"], name: "Markdown → HTML", in: ["md", "text"], out: ["html"], pop: 35, kw: ["md", "convert", "render"], desc: "Render Markdown as HTML." },
  { src: ["12.10"], name: "Base64 Encoder", in: ["text", "any"], out: ["text"], pop: 45, kw: ["base64", "encode", "data uri"], desc: "Encode text or a file as Base64." },
  { src: ["12.11"], name: "Base64 Decoder", in: ["text"], out: ["text", "any"], pop: 40, kw: ["base64", "decode"], desc: "Decode Base64 back to text or a file." },
  { src: ["12.12"], name: "URL Encoder", in: ["text"], out: ["text"], kw: ["percent encoding", "encode", "escape", "uri"], desc: "Percent-encode text for use in a URL." },
  { src: ["12.13"], name: "URL Decoder", in: ["text"], out: ["text"], kw: ["percent encoding", "decode", "unescape", "uri"], desc: "Decode a percent-encoded URL." },
  { src: ["12.14"], name: "UUID Generator", in: [], out: ["text"], pop: 40, kw: ["guid", "unique id", "random id"], desc: "Generate random UUIDs." },
  { src: ["12.15"], name: "Password Generator", in: [], out: ["text"], pop: 50, kw: ["random password", "strong password", "secure"], desc: "Generate strong random passwords." },
  { src: ["12.16"], name: "Hash Generator", in: ["text"], out: ["text"], pop: 35, kw: ["hash", "sha256", "sha1", "md5", "digest"], desc: "Hash text with SHA-256, SHA-1, MD5 and more." },
  { src: ["12.18"], name: "Timestamp Converter", in: ["text"], out: ["text"], pop: 35, kw: ["unix time", "epoch", "date", "iso 8601"], desc: "Convert between Unix timestamps and readable dates." },
  { src: ["12.19"], name: "Regex Tester", in: ["text"], out: ["text"], pop: 35, kw: ["regular expression", "regexp", "pattern", "match"], desc: "Test a regular expression against sample text." },
  { src: ["12.20"], name: "User-Agent Viewer", slug: "user-agent-viewer", in: [], out: ["text"], kw: ["browser", "user agent", "my browser"], desc: "Show your browser's user-agent string and what it means." },
]);

export const networkTools = defineCategory(
  "network",
  { phase: "17", sub: "Network / Information", net: "required" },
  [
    { src: ["13.1"], name: "IP Address Lookup", in: ["text"], out: ["json"], pop: 35, kw: ["ip", "ip info", "isp", "owner"], desc: "Look up details for an IP address." },
    { src: ["13.2"], name: "Public IP Detector", in: [], out: ["text"], pop: 40, kw: ["what is my ip", "my ip", "public ip"], desc: "Show your public IP address." },
    { src: ["13.3"], name: "IP Geolocation", in: ["text"], out: ["json"], kw: ["ip location", "country", "city"], desc: "Find the approximate location of an IP address." },
    { src: ["13.4"], name: "Location Lookup", in: ["text"], out: ["json"], kw: ["address", "place", "geocode", "map"], desc: "Look up a place or address and get its coordinates." },
    { src: ["13.5"], name: "Coordinates Lookup", in: ["text"], out: ["json"], kw: ["latitude", "longitude", "gps", "reverse geocode"], desc: "Turn latitude and longitude into a place name." },
    { src: ["13.6"], name: "User-Agent Lookup", slug: "user-agent-lookup", in: ["text"], out: ["json"], net: "none", kw: ["user agent", "parse", "browser", "device"], desc: "Parse any user-agent string into browser, OS and device." },
    { src: ["13.7"], name: "DNS Lookup", in: ["text"], out: ["json"], pop: 30, kw: ["dns", "a record", "mx", "txt", "nameserver", "domain"], desc: "Look up DNS records for a domain." },
    { src: ["13.8"], name: "WHOIS Lookup", in: ["text"], out: ["json"], kw: ["whois", "domain owner", "registrar", "domain"], desc: "Look up the registration details of a domain." },
    { src: ["13.9"], name: "Website Information Lookup", in: ["url"], out: ["json"], kw: ["website", "site info", "headers", "ssl", "domain"], desc: "Get basic information about a website." },
  ],
);

export const fileUtilityTools = defineCategory("file-utility", { phase: "12", sub: "File Utilities" }, [
  { src: ["14.1"], name: "File Compressor", in: ["any"], out: ["zip"], batch: true, pop: 45, kw: ["compress", "shrink", "reduce size", "zip"], desc: "Compress any files to save space." },
  { src: ["14.2", "12.22"], name: "ZIP Creator", in: ["any"], out: ["zip"], batch: true, pop: 55, kw: ["zip", "archive", "bundle", "compress folder"], desc: "Bundle files into a ZIP archive." },
  { src: ["14.3", "12.23"], name: "ZIP Extractor", in: ["zip"], out: ["any"], pop: 55, kw: ["unzip", "extract", "decompress", "open zip"], desc: "Extract the files from a ZIP archive." },
  { src: ["14.4"], name: "File Merger", in: ["any"], out: ["any"], batch: true, kw: ["combine", "join", "concatenate"], desc: "Join split file parts back into one file." },
  { src: ["14.5"], name: "File Splitter", in: ["any"], out: ["zip"], kw: ["split", "chunks", "parts", "divide"], desc: "Split a large file into smaller parts." },
  { src: ["14.6"], name: "File Type Converter", in: ["any"], out: ["any"], batch: true, pop: 50, kw: ["convert", "change format", "file format"], desc: "Convert a file to another format using the matching OneStop tool." },
  { src: ["14.7", "12.21"], name: "File Metadata Viewer", in: ["any"], out: ["json"], batch: true, pop: 30, status: "demo", kw: ["file info", "properties", "size", "mime type"], desc: "See a file's name, size, real format, checksums and last-modified date." },
  { src: ["14.8"], name: "Metadata Remover", in: ["any"], out: ["any"], batch: true, kw: ["strip metadata", "privacy", "clean", "exif"], desc: "Strip hidden metadata from files before sharing." },
  { src: ["14.9", "12.17"], name: "File Checksum Generator", slug: "checksum-generator", in: ["any"], out: ["text"], batch: true, pop: 30, kw: ["checksum", "sha256", "md5", "verify", "integrity", "hash"], desc: "Compute checksums to verify a file hasn't changed." },
  { src: ["14.10"], name: "Duplicate File Detector", in: ["any"], out: ["json"], batch: true, kw: ["duplicates", "identical files", "dedupe"], desc: "Find identical files in a set of uploads." },
]);
