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
};

export function getToolInputHint(toolId: string): ToolInputHint | undefined {
  return TOOL_INPUT_HINTS[toolId];
}
