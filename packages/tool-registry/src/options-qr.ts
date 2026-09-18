// Options for the QR tools (11-qr-tools.md).
//
// Every QR tool shares the same look-and-feel controls (size, quiet zone, error correction and
// the two colours), so they are built once here. The per-tool options on top of that are the
// fields the payload conventions need: a Wi-Fi code needs a password, a contact code needs an
// organisation, and so on.
import type { ToolOption, SelectOption, NumberOption, TextOption } from "./options";

const format: SelectOption = {
  id: "format",
  type: "select",
  label: "Image format",
  default: "png",
  choices: [
    { value: "png", label: "PNG (share anywhere)" },
    { value: "svg", label: "SVG (sharp at any size)" },
  ],
};

const size: NumberOption = {
  id: "size",
  type: "number",
  label: "Size",
  default: 512,
  min: 64,
  max: 4096,
  step: 32,
  unit: "px",
};

const margin: NumberOption = {
  id: "margin",
  type: "number",
  label: "Quiet zone",
  default: 4,
  min: 0,
  max: 16,
  unit: "modules",
  help: "The blank border around the code. Scanners need at least 4; below that, some phones fail.",
};

const ecc: SelectOption = {
  id: "ecc",
  type: "select",
  label: "Error correction",
  default: "M",
  choices: [
    { value: "L", label: "Low (7%) - smallest code" },
    { value: "M", label: "Medium (15%) - recommended" },
    { value: "Q", label: "Quartile (25%)" },
    { value: "H", label: "High (30%) - survives damage and logos" },
  ],
  help: "How much of the code can be scratched, covered or printed badly and still be readable.",
};

const dark: TextOption = {
  id: "dark",
  type: "text",
  label: "Code colour",
  default: "#000000",
  placeholder: "#000000",
};

const light: TextOption = {
  id: "light",
  type: "text",
  label: "Background colour",
  default: "#ffffff",
  placeholder: "#ffffff",
  help: 'A hex colour, or "transparent" for no background.',
};

/** The controls every QR tool offers. */
const style: ToolOption[] = [format, size, margin, ecc, dark, light];

const customisation: ToolOption[] = [
  {
    id: "moduleShape",
    type: "select",
    label: "Dot shape",
    default: "square",
    choices: [
      { value: "square", label: "Square (most reliable)" },
      { value: "rounded", label: "Rounded" },
      { value: "dot", label: "Dots" },
    ],
  },
  {
    id: "eyeShape",
    type: "select",
    label: "Corner shape",
    default: "square",
    choices: [
      { value: "square", label: "Square" },
      { value: "rounded", label: "Rounded" },
      { value: "circle", label: "Circle" },
    ],
  },
  {
    id: "eyeColor",
    type: "text",
    label: "Corner colour",
    default: "",
    placeholder: "Same as the code",
  },
  {
    id: "logo",
    type: "image",
    label: "Logo in the middle",
    default: "",
    help: "Optional. Error correction is raised automatically so the code still scans.",
  },
  {
    id: "logoScale",
    type: "number",
    label: "Logo size",
    default: 20,
    min: 5,
    max: 30,
    unit: "% of width",
  },
];

/** Content type + how big the file may get before it becomes a hosted link instead. */
const hostedMode: SelectOption = {
  id: "mode",
  type: "select",
  label: "How to store it",
  default: "auto",
  choices: [
    { value: "auto", label: "Automatic - inside the code if it fits, otherwise a hosted page" },
    { value: "embed", label: "Inside the code (tiny files only, works with no server)" },
    { value: "link", label: "A hosted OneStop page" },
  ],
  help: "A QR code holds about 2 KB, so anything bigger has to live on a page the code points at.",
};

export const QR_TOOL_OPTIONS: Record<string, ToolOption[]> = {
  "qr-code-generator": style,
  "qr-code-scanner": [
    {
      id: "showRaw",
      type: "boolean",
      label: "Show the raw payload",
      default: false,
      help: "Useful when a code holds a format OneStop does not recognise.",
    },
  ],
  "url-to-qr": style,
  "text-to-qr": style,
  "image-to-qr": [
    hostedMode,
    {
      id: "pageTitle",
      type: "text",
      label: "Page title",
      default: "",
      placeholder: "Shared image",
    },
    ...style,
  ],
  "audio-to-qr": [
    hostedMode,
    {
      id: "pageTitle",
      type: "text",
      label: "Page title",
      default: "",
      placeholder: "Shared audio",
    },
    ...style,
  ],
  "contact-to-qr": [
    { id: "organisation", type: "text", label: "Organisation", default: "" },
    { id: "jobTitle", type: "text", label: "Job title", default: "" },
    { id: "phone", type: "text", label: "Phone", default: "", placeholder: "+44 20 7946 0000" },
    { id: "email", type: "text", label: "Email", default: "", placeholder: "me@example.com" },
    {
      id: "website",
      type: "text",
      label: "Website",
      default: "",
      placeholder: "https://example.com",
    },
    { id: "address", type: "text", label: "Address", default: "" },
    { id: "note", type: "text", label: "Note", default: "", multiline: true },
    ...style,
  ],
  "email-to-qr": [
    { id: "subject", type: "text", label: "Subject", default: "" },
    { id: "body", type: "text", label: "Message", default: "", multiline: true },
    ...style,
  ],
  "phone-to-qr": [
    {
      id: "action",
      type: "select",
      label: "When scanned",
      default: "call",
      choices: [
        { value: "call", label: "Start a phone call" },
        { value: "sms", label: "Start a text message" },
      ],
    },
    {
      id: "message",
      type: "text",
      label: "Message",
      default: "",
      multiline: true,
      showWhen: { option: "action", equals: ["sms"] },
    },
    ...style,
  ],
  "wifi-to-qr": [
    {
      id: "security",
      type: "select",
      label: "Security",
      default: "WPA",
      choices: [
        { value: "WPA", label: "WPA / WPA2 / WPA3" },
        { value: "WEP", label: "WEP (old)" },
        { value: "nopass", label: "Open (no password)" },
      ],
    },
    {
      id: "password",
      type: "text",
      label: "Password",
      default: "",
      secret: true,
      showWhen: { option: "security", equals: ["WPA", "WEP"] },
      help: "Never stored: it goes straight into the code and is left out of the job record.",
    },
    { id: "hidden", type: "boolean", label: "Hidden network", default: false },
    ...style,
  ],
  "qr-code-customization": [...style, ...customisation],
  "dynamic-qr-code": [
    { id: "title", type: "text", label: "Name", default: "", placeholder: "Menu QR" },
    ...style,
  ],
  "custom-qr-landing-page": [
    { id: "title", type: "text", label: "Page title", default: "", placeholder: "Our menu" },
    { id: "subtitle", type: "text", label: "Subtitle", default: "" },
    {
      id: "accent",
      type: "text",
      label: "Accent colour",
      default: "#2563eb",
      placeholder: "#2563eb",
    },
    {
      id: "linkLabel",
      type: "text",
      label: "Button label",
      default: "",
      placeholder: "Open the menu",
    },
    {
      id: "linkUrl",
      type: "text",
      label: "Button link",
      default: "",
      placeholder: "https://example.com",
    },
    ...style,
  ],
  "qr-content-page": [
    { id: "title", type: "text", label: "Page title", default: "", placeholder: "Shared files" },
    { id: "subtitle", type: "text", label: "Subtitle", default: "" },
    {
      id: "accent",
      type: "text",
      label: "Accent colour",
      default: "#2563eb",
      placeholder: "#2563eb",
    },
    ...style,
  ],
  "qr-code-analytics": [
    {
      id: "detail",
      type: "select",
      label: "Detail",
      default: "summary",
      choices: [
        { value: "summary", label: "Totals per code" },
        { value: "full", label: "Totals plus recent scans" },
      ],
    },
  ],
};
