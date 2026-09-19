// Labels for a tool's main input box (11-qr-tools.md).
//
// The generic tool page asks the registry what a tool needs; for most tools "Paste or type here"
// is honest enough, but "Wi-Fi → QR" asking for unlabelled text is not. This is metadata, not
// per-tool UI code: the page still has no knowledge of any individual tool, and the AI assistant
// (phase 16) can read the same labels when it asks the user for a missing value.
export interface ToolInputHint {
  label: string;
  placeholder?: string;
  help?: string;
}

export const TOOL_INPUT_HINTS: Record<string, ToolInputHint> = {
  "qr-code-generator": {
    label: "Text or link to encode",
    placeholder: "https://example.com, or any text",
  },
  "url-to-qr": { label: "Link", placeholder: "https://example.com" },
  "text-to-qr": { label: "Text", placeholder: "Anything you want the code to hold" },
  "contact-to-qr": { label: "Full name", placeholder: "Ada Lovelace" },
  "email-to-qr": { label: "Email address", placeholder: "me@example.com" },
  "phone-to-qr": { label: "Phone number", placeholder: "+44 20 7946 0000" },
  "wifi-to-qr": {
    label: "Network name (SSID)",
    placeholder: "My Home Wi-Fi",
    help: "Exactly as it appears in the Wi-Fi list, including capitals.",
  },
  "qr-code-customization": {
    label: "Text or link to encode",
    placeholder: "https://example.com, or any text",
  },
  "dynamic-qr-code": {
    label: "Where the code should go today",
    placeholder: "https://example.com",
    help: "You can change this later without reprinting the code.",
  },
  "custom-qr-landing-page": {
    label: "Page text",
    placeholder: "What should the page say?",
  },
  "qr-content-page": {
    label: "Page text (optional)",
    placeholder: "A note to go with the files",
  },
  // 12-dev-utility-tools.md — the formatters, encoders and testers all have one text box, and
  // "Paste or type here" would not say which of the two things a two-sided tool wants.
  "html-formatter": { label: "HTML", placeholder: "<p>Paste your markup here</p>" },
  "css-formatter": { label: "CSS", placeholder: "body { margin: 0 }" },
  "javascript-formatter": { label: "JavaScript", placeholder: "const hello = () => 'hi'" },
  "markdown-converter": { label: "Markdown", placeholder: "# Title, then some **bold** text." },
  "markdown-to-html": { label: "Markdown", placeholder: "# Title, then some **bold** text." },
  "base64-encoder": {
    label: "Text to encode",
    placeholder: "Anything — or choose a file instead",
  },
  "base64-decoder": {
    label: "Base64 to decode",
    placeholder: "SGVsbG8sIHdvcmxkIQ==",
    help: "A data: URL works too.",
  },
  "url-encoder": { label: "Text to encode", placeholder: "search terms & symbols" },
  "url-decoder": { label: "Encoded text", placeholder: "search%20terms%20%26%20symbols" },
  "hash-generator": { label: "Text to hash", placeholder: "Anything you want a fingerprint of" },
  "timestamp-converter": {
    label: "Timestamp or date",
    placeholder: "1700000000, 2023-11-14T22:13:20Z, or now",
  },
  "regex-tester": {
    label: "Sample text",
    placeholder: "The text to run the expression against",
    help: "The expression itself goes in the options below.",
  },
  // 17-online-media-network-tools.md — "Paste or type here" would not tell anyone whether a tool
  // wants an address, a domain, a pair of coordinates or a browser string.
  "youtube-to-mp3": { label: "YouTube link", placeholder: "https://www.youtube.com/watch?v=..." },
  "youtube-to-mp4": { label: "YouTube link", placeholder: "https://www.youtube.com/watch?v=..." },
  "youtube-quality-selector": {
    label: "YouTube link",
    placeholder: "https://www.youtube.com/watch?v=...",
    help: "Lists every quality this video offers, without downloading anything.",
  },
  "instagram-reel-to-mp3": {
    label: "Instagram Reel link",
    placeholder: "https://www.instagram.com/reel/...",
  },
  "instagram-reel-to-mp4": {
    label: "Instagram Reel link",
    placeholder: "https://www.instagram.com/reel/...",
  },
  "instagram-quality-selector": {
    label: "Instagram Reel link",
    placeholder: "https://www.instagram.com/reel/...",
  },
  "spotify-link-info": {
    label: "Spotify link",
    placeholder: "https://open.spotify.com/track/...",
    help: "Track, album, artist, playlist, show or episode. Information only — no audio is downloaded.",
  },
  "ip-address-lookup": {
    label: "IP address",
    placeholder: "8.8.8.8",
    help: "IPv4 or IPv6.",
  },
  "ip-geolocation": { label: "IP address", placeholder: "8.8.8.8" },
  "location-lookup": {
    label: "Place or address",
    placeholder: "Eiffel Tower, Paris",
    help: "A landmark, a full address or a town name all work.",
  },
  "coordinates-lookup": {
    label: "Coordinates",
    placeholder: "48.8584, 2.2945",
    help: "Decimal degrees, or 48°51'29\"N 2°17'40\"E.",
  },
  "user-agent-lookup": {
    label: "User-agent string",
    placeholder: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...",
    help: "Any string, not just your own browser's.",
  },
  "dns-lookup": { label: "Domain name", placeholder: "example.com" },
  "whois-lookup": {
    label: "Domain name or IP address",
    placeholder: "example.com",
    help: "A domain gives its registration; an address gives the network it belongs to.",
  },
  "website-information-lookup": {
    label: "Website address",
    placeholder: "https://example.com",
  },
};

export function getToolInputHint(toolId: string): ToolInputHint | undefined {
  return TOOL_INPUT_HINTS[toolId];
}
