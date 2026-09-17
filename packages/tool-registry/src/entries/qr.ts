import { defineCategory } from "../define";

// Features §10. Static QR tools run on-device; dynamic QR needs a stable OneStop URL and an
// owner, so those entries are online-only and require an account.
export const qrTools = defineCategory("qr", { phase: "11", sub: "QR" }, [
  { src: ["10.1"], name: "QR Code Generator", in: ["text", "url"], out: ["png", "svg"], pop: 88, kw: ["create qr", "make qr", "barcode"], desc: "Create a QR code from any text or link." },
  { src: ["10.2"], name: "QR Code Scanner", in: ["image"], out: ["text"], pop: 60, kw: ["scan", "read qr", "decode", "camera"], desc: "Read the contents of a QR code from an image or camera." },
  { src: ["10.3"], name: "URL → QR", in: ["url"], out: ["png", "svg"], pop: 55, kw: ["link", "website", "qr code"], desc: "Make a QR code that opens a web link." },
  { src: ["10.4"], name: "Text → QR", in: ["text"], out: ["png", "svg"], kw: ["message", "qr code"], desc: "Make a QR code containing plain text." },
  { src: ["10.5"], name: "Image → QR", in: ["image"], out: ["png", "svg"], kw: ["photo", "picture", "qr code"], desc: "Make a QR code that shows an image." },
  { src: ["10.6"], name: "Audio → QR", in: ["audio"], out: ["png", "svg"], kw: ["sound", "voice", "music", "qr code"], desc: "Make a QR code that plays an audio clip." },
  { src: ["10.7"], name: "Contact → QR", in: ["text"], out: ["png", "svg"], kw: ["vcard", "business card", "contact card", "qr code"], desc: "Make a QR code that saves a contact card (vCard)." },
  { src: ["10.8"], name: "Email → QR", in: ["text"], out: ["png", "svg"], kw: ["mailto", "email address", "qr code"], desc: "Make a QR code that starts an email." },
  { src: ["10.9"], name: "Phone → QR", in: ["text"], out: ["png", "svg"], kw: ["call", "phone number", "tel", "qr code"], desc: "Make a QR code that dials a phone number." },
  { src: ["10.10"], name: "Wi-Fi → QR", slug: "wifi-to-qr", in: ["text"], out: ["png", "svg"], pop: 45, kw: ["wifi", "wireless", "network password", "qr code"], desc: "Make a QR code that joins a Wi-Fi network." },
  { src: ["10.11"], name: "Dynamic QR Code", in: ["url", "text"], out: ["png", "svg"], auth: true, net: "required", kw: ["editable", "change destination", "redirect", "qr code"], desc: "Create a QR code whose destination you can change later." },
  { src: ["10.12"], name: "Custom QR Landing Page", in: ["text"], out: ["url"], auth: true, net: "required", kw: ["landing page", "hosted page", "qr code"], desc: "Build a OneStop-hosted page for a QR code to open." },
  { src: ["10.13"], name: "QR Code Customization", in: ["text", "url"], out: ["png", "svg"], kw: ["colors", "logo", "style", "design", "qr code"], desc: "Style a QR code with colours, a logo and custom shapes." },
  { src: ["10.14"], name: "QR Code Analytics", in: [], out: ["json"], auth: true, net: "required", kw: ["scans", "statistics", "tracking", "qr code"], desc: "See how often your dynamic QR codes are scanned." },
  { src: ["10.15"], name: "QR Code → Content Page", slug: "qr-content-page", in: ["any", "text"], out: ["url", "png"], auth: true, net: "required", kw: ["hosted content", "files", "share", "qr code"], desc: "Point a QR code at a OneStop page with text, images, audio, links or files." },
]);
