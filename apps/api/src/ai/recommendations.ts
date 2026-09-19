// External recommendations (master plan §7.3; 16-ai-assistant.md).
//
// A curated, static list — deliberately. Fetching a third-party page to build this at runtime
// would be an SSRF surface for no benefit (master plan §15), so nothing here touches the network:
// OneStop only ever renders these links, and labels them as external services.
//
// Every entry carries the four fields §7.3 asks for: site name, link, purpose, limitation.
import type { ExternalRecommendation, RecommendationGroups } from "@onestop/types";

interface Topic {
  id: string;
  /** What the user was trying to do, in their words. */
  label: string;
  match: RegExp;
  free: ExternalRecommendation[];
  paid: ExternalRecommendation[];
}

const free = (
  name: string,
  url: string,
  purpose: string,
  limitation: string,
): ExternalRecommendation => ({ name, url, purpose, limitation, pricing: "free" });

const paid = (
  name: string,
  url: string,
  purpose: string,
  limitation: string,
): ExternalRecommendation => ({ name, url, purpose, limitation, pricing: "paid" });

const TOPICS: Topic[] = [
  {
    id: "3d",
    label: "3D modelling and rendering",
    match: /\b3d\b|\bmesh\b|\bcad\b|\bblender\b|\brender(ing)?\b|\bstl\b|\bobj file\b/i,
    free: [
      free(
        "Blender",
        "https://www.blender.org/",
        "Full 3D modelling, sculpting, animation and rendering.",
        "Desktop application with a steep learning curve; nothing runs in the browser.",
      ),
      free(
        "Tinkercad",
        "https://www.tinkercad.com/",
        "Simple browser-based 3D design for printing.",
        "Requires an Autodesk account and an internet connection; limited for complex models.",
      ),
      free(
        "FreeCAD",
        "https://www.freecad.org/",
        "Parametric CAD modelling for engineering parts.",
        "Desktop only; the interface is dense compared with commercial CAD.",
      ),
    ],
    paid: [
      paid(
        "Autodesk Fusion",
        "https://www.autodesk.com/products/fusion-360/",
        "Professional parametric CAD, CAM and simulation.",
        "Subscription; the free personal tier is time-limited and feature-restricted.",
      ),
      paid(
        "SketchUp Pro",
        "https://www.sketchup.com/",
        "Architectural and product modelling.",
        "Annual subscription; the free web version cannot export most CAD formats.",
      ),
    ],
  },
  {
    id: "transcription",
    label: "speech to text and transcription",
    match:
      /\btranscri|\bsubtitle.*(generate|create|make)|\bspeech.to.text\b|\bvoice.to.text\b|\bdictat/i,
    free: [
      free(
        "Whisper (OpenAI, open source)",
        "https://github.com/openai/whisper",
        "Runs speech-to-text entirely on your own machine.",
        "Needs Python and a reasonably fast CPU or GPU; large models are slow on laptops.",
      ),
      free(
        "whisper.cpp",
        "https://github.com/ggml-org/whisper.cpp",
        "A lightweight local build of Whisper for modest hardware.",
        "Command-line only; you have to download the model yourself.",
      ),
      free(
        "Vosk",
        "https://alphacephei.com/vosk/",
        "Offline speech recognition in many languages.",
        "Lower accuracy than Whisper, especially with accents or background noise.",
      ),
    ],
    paid: [
      paid(
        "Otter.ai",
        "https://otter.ai/",
        "Meeting transcription with speaker labels and summaries.",
        "Free tier caps monthly minutes; audio is uploaded to their servers.",
      ),
      paid(
        "Descript",
        "https://www.descript.com/",
        "Transcript-driven audio and video editing.",
        "Subscription; export limits on the free plan.",
      ),
    ],
  },
  {
    id: "text-to-speech",
    label: "text to speech and voice generation",
    match: /\btext.to.speech\b|\bvoice.?over\b|\bnarrat|\btts\b|\bread (this|it) (out )?aloud\b/i,
    free: [
      free(
        "Piper",
        "https://github.com/OHF-Voice/piper1-gpl",
        "Fast, fully local neural text-to-speech.",
        "Command-line; voice quality varies by the voice model you download.",
      ),
      free(
        "Coqui TTS",
        "https://github.com/coqui-ai/TTS",
        "Local text-to-speech with many voices and languages.",
        "Needs Python and a GPU for the better models; the project is community-maintained.",
      ),
    ],
    paid: [
      paid(
        "ElevenLabs",
        "https://elevenlabs.io/",
        "High-quality synthetic voices and voice cloning.",
        "Free tier is a small monthly character budget; audio is generated on their servers.",
      ),
    ],
  },
  {
    id: "design",
    label: "graphic design and layout",
    match: /\b(design|poster|flyer|logo|brochure|banner|mockup|brand kit|illustration)\b/i,
    free: [
      free(
        "GIMP",
        "https://www.gimp.org/",
        "Full raster image editing and retouching.",
        "Desktop only; the interface differs a lot from Photoshop.",
      ),
      free(
        "Inkscape",
        "https://inkscape.org/",
        "Vector illustration and logo work (SVG).",
        "Desktop only; large documents can be slow.",
      ),
      free(
        "Penpot",
        "https://penpot.app/",
        "Open-source interface design and prototyping in the browser.",
        "Self-hosting is work; the hosted version needs an account and internet.",
      ),
    ],
    paid: [
      paid(
        "Canva Pro",
        "https://www.canva.com/",
        "Template-driven design for social, print and slides.",
        "Subscription; the free tier watermarks or locks many assets.",
      ),
      paid(
        "Affinity Designer",
        "https://affinity.serif.com/designer/",
        "Professional vector and raster design, one-off licence.",
        "Paid up front; desktop and iPad only.",
      ),
    ],
  },
  {
    id: "video-editing",
    label: "timeline video editing",
    match:
      /\b(video editor|edit (the |this )?video|timeline|colou?r grade|motion graphics|after effects)\b/i,
    free: [
      free(
        "Shotcut",
        "https://shotcut.org/",
        "Open-source non-linear video editor built on FFmpeg.",
        "Desktop only; fewer effects than commercial editors.",
      ),
      free(
        "Kdenlive",
        "https://kdenlive.org/",
        "Multi-track video editing with effects and transitions.",
        "Desktop only; can be unstable on very long projects.",
      ),
      free(
        "DaVinci Resolve (free edition)",
        "https://www.blackmagicdesign.com/products/davinciresolve",
        "Professional editing and colour grading.",
        "Large download and demanding hardware; some codecs and features are Studio-only.",
      ),
    ],
    paid: [
      paid(
        "Adobe Premiere Pro",
        "https://www.adobe.com/products/premiere.html",
        "Industry-standard video editing.",
        "Monthly subscription; heavy system requirements.",
      ),
      paid(
        "Final Cut Pro",
        "https://www.apple.com/final-cut-pro/",
        "Fast timeline editing on Apple silicon.",
        "One-off purchase, macOS only.",
      ),
    ],
  },
  {
    id: "esign",
    label: "legally binding e-signatures",
    match:
      /\b(legally binding|certificate authority|trusted (digital )?signature|esign|docusign|notari[sz])\b/i,
    free: [
      free(
        "Documenso",
        "https://documenso.com/",
        "Open-source document signing you can self-host.",
        "Self-hosting requires a server; the hosted tier limits documents.",
      ),
      free(
        "SignRequest free tier",
        "https://signrequest.com/",
        "Simple e-signature requests by email.",
        "Small monthly document allowance; documents pass through their servers.",
      ),
    ],
    paid: [
      paid(
        "DocuSign",
        "https://www.docusign.com/",
        "Audit-trailed, legally recognised e-signature workflows.",
        "Subscription per user; envelope limits on lower tiers.",
      ),
      paid(
        "Adobe Acrobat Sign",
        "https://www.adobe.com/sign.html",
        "Certificate-backed signatures inside the Adobe ecosystem.",
        "Subscription; needs an Adobe account.",
      ),
    ],
  },
  {
    id: "ocr-premium",
    label: "high-accuracy OCR and handwriting",
    match: /\b(handwrit|premium ocr|better ocr|accurate ocr|table extraction|receipt scanning)\b/i,
    free: [
      free(
        "Tesseract",
        "https://github.com/tesseract-ocr/tesseract",
        "The open-source OCR engine OneStop already uses locally.",
        "Struggles with handwriting and poor scans; no layout reconstruction.",
      ),
      free(
        "OCRmyPDF",
        "https://ocrmypdf.readthedocs.io/",
        "Adds a searchable text layer to scanned PDFs, locally.",
        "Command-line; same Tesseract accuracy limits.",
      ),
    ],
    paid: [
      paid(
        "Google Document AI",
        "https://cloud.google.com/document-ai",
        "Form, table and handwriting extraction at high accuracy.",
        "Pay per page after a small free allowance; documents are uploaded to Google.",
      ),
      paid(
        "ABBYY FineReader",
        "https://pdf.abbyy.com/",
        "Best-in-class OCR with layout reconstruction.",
        "Paid licence; desktop application.",
      ),
    ],
  },
  {
    id: "translation",
    label: "high-quality translation",
    match: /\b(translat|localis|localiz)\w*\b/i,
    free: [
      free(
        "LibreTranslate",
        "https://libretranslate.com/",
        "Open-source machine translation you can self-host and run offline.",
        "Self-hosted quality depends on the model; the public instance rate-limits.",
      ),
      free(
        "Argos Translate",
        "https://github.com/argosopentech/argos-translate",
        "Offline neural translation as a Python library.",
        "Model packs per language pair must be downloaded; quality trails the big services.",
      ),
    ],
    paid: [
      paid(
        "DeepL",
        "https://www.deepl.com/",
        "Noticeably natural translation for European languages.",
        "Free tier caps characters per month; text is sent to their servers.",
      ),
    ],
  },
  {
    id: "image-generation",
    label: "image generation",
    match:
      /\b(generate|create|make|draw)\b.{0,20}\b(image|picture|art|illustration|photo)\b|\btext.to.image\b|\bdiffusion\b/i,
    free: [
      free(
        "AUTOMATIC1111 Stable Diffusion WebUI",
        "https://github.com/AUTOMATIC1111/stable-diffusion-webui",
        "Runs Stable Diffusion entirely on your own GPU.",
        "Needs a capable GPU (roughly 6 GB VRAM or more) and a large model download.",
      ),
      free(
        "ComfyUI",
        "https://github.com/comfyanonymous/ComfyUI",
        "Node-based local image generation and editing.",
        "Same hardware requirement; the node graph has a learning curve.",
      ),
      free(
        "Krita with AI Diffusion",
        "https://krita-artists.org/",
        "Local painting with generative assistance.",
        "Plugin setup is manual and GPU-bound.",
      ),
    ],
    paid: [
      paid(
        "Midjourney",
        "https://www.midjourney.com/",
        "High-quality image generation from prompts.",
        "Subscription only; images are generated on their servers and are public by default on lower tiers.",
      ),
    ],
  },
  {
    id: "code",
    label: "writing software",
    match: /\b(write|build|make)\b.{0,20}\b(app|website|program|script|code|plugin)\b/i,
    free: [
      free(
        "Visual Studio Code",
        "https://code.visualstudio.com/",
        "A free editor for writing and debugging code.",
        "It is an editor, not a hosting service — you still run the code yourself.",
      ),
      free(
        "Continue",
        "https://www.continue.dev/",
        "Open-source coding assistance that can run against a local Ollama model.",
        "Quality depends on the local model and your hardware.",
      ),
    ],
    paid: [
      paid(
        "GitHub Copilot",
        "https://github.com/features/copilot",
        "Inline code completion and chat in your editor.",
        "Subscription; your code context is sent to GitHub.",
      ),
    ],
  },
];

/** The catch-all when nothing above matches: honest, general, still four fields each. */
const GENERAL: { free: ExternalRecommendation[]; paid: ExternalRecommendation[] } = {
  free: [
    free(
      "LibreOffice",
      "https://www.libreoffice.org/",
      "A complete free office suite for documents, spreadsheets and slides.",
      "Desktop application; some Microsoft Office layouts shift slightly on import.",
    ),
    free(
      "GIMP",
      "https://www.gimp.org/",
      "Free image editing and retouching.",
      "Desktop only, with a different workflow from commercial editors.",
    ),
    free(
      "FFmpeg",
      "https://ffmpeg.org/",
      "Command-line audio and video conversion and filtering.",
      "No graphical interface; every operation is a command.",
    ),
  ],
  paid: [
    paid(
      "Adobe Acrobat Pro",
      "https://www.adobe.com/acrobat.html",
      "Advanced PDF editing, redaction and accessibility checking.",
      "Subscription; needs an Adobe account.",
    ),
    paid(
      "Microsoft 365",
      "https://www.microsoft.com/microsoft-365",
      "The original Office formats, with full fidelity.",
      "Subscription per user.",
    ),
  ],
};

export const EXTERNAL_NOTICE =
  "These are external services, not part of OneStop. Opening them needs an internet connection, and anything you upload there is subject to that service's own privacy policy.";

/** Free and Paid recommendations for a request OneStop cannot fulfil (master plan §7.3). */
export function recommendationsFor(request: string): RecommendationGroups {
  const topic = TOPICS.find((t) => t.match.test(request));
  if (!topic) return { topic: "this kind of task", free: GENERAL.free, paid: GENERAL.paid };
  return { topic: topic.label, free: topic.free, paid: topic.paid };
}

/** Every curated topic id, for the tests and the docs. */
export function recommendationTopics(): string[] {
  return TOPICS.map((t) => t.id);
}
