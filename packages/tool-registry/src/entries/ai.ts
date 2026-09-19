import { defineCategory } from "../define";

// Features §11. AI tools run on local Ollama or an opt-in free hosted API (16-ai-assistant.md),
// hence `net: "optional"`. The assistant itself lives at /assistant; its entry links there.
export const aiTools = defineCategory(
  "ai",
  { phase: "16", sub: "AI", net: "optional", status: "available" },
  [
  { src: ["11.1"], name: "OneStop AI Assistant", slug: "ai-assistant", in: ["text", "any"], out: ["any"], batch: true, pop: 95, kw: ["assistant", "chat", "ask", "automate", "chain tools"], desc: "Describe a task in plain words and let OneStop chain the right tools." },
  { src: ["11.2"], name: "AI Email Drafter", in: ["text"], out: ["text"], pop: 45, kw: ["email", "write email", "reply", "draft"], desc: "Draft an email from a few bullet points." },
  { src: ["11.3"], name: "AI Text Generator", in: ["text"], out: ["text"], pop: 40, kw: ["write", "generate text", "content", "copy"], desc: "Generate text from a prompt." },
  { src: ["11.4"], name: "AI Text Rewriter", in: ["text"], out: ["text"], pop: 40, kw: ["rewrite", "paraphrase", "rephrase", "tone"], desc: "Rewrite text in a different tone or length." },
  { src: ["11.5"], name: "AI Summarizer", in: ["text", "txt", "pdf", "docx"], out: ["text"], pop: 55, kw: ["summary", "summarize", "tldr", "key points"], desc: "Summarize text or a document with AI." },
  { src: ["11.6"], name: "AI Grammar Checker", in: ["text"], out: ["text"], kw: ["grammar", "spelling", "proofread", "correct"], desc: "Fix grammar and style with AI suggestions." },
  { src: ["11.7"], name: "AI Translator", in: ["text", "txt", "docx"], out: ["text"], pop: 40, kw: ["translate", "language"], desc: "Translate text with AI." },
  { src: ["11.8"], name: "AI OCR", in: ["image", "pdf"], out: ["text"], kw: ["ocr", "read text", "handwriting", "scan"], desc: "Read text from images and scans with AI." },
  { src: ["11.9"], name: "AI Document Analyzer", in: ["pdf", "docx", "txt"], out: ["text"], kw: ["analyze", "insights", "review document"], desc: "Get an AI analysis of a document's content and structure." },
  { src: ["11.10"], name: "AI PDF Summarizer", in: ["pdf"], out: ["text"], pop: 45, kw: ["summary", "summarize pdf", "key points"], desc: "Summarize a PDF with AI." },
  { src: ["11.11"], name: "Ask Questions About a File", slug: "ask-questions-about-a-file", in: ["pdf", "docx", "txt", "csv"], out: ["text"], pop: 50, kw: ["chat with pdf", "question", "document q&a", "rag"], desc: "Ask questions and get answers from an uploaded file." },
  { src: ["11.12"], name: "Extract Information from Documents", slug: "extract-information", in: ["pdf", "docx", "txt", "image"], out: ["json"], kw: ["extract", "fields", "invoice", "entities", "parse"], desc: "Pull names, dates, totals and other fields out of documents." },
  { src: ["11.13"], name: "Unstructured → Structured Data", slug: "unstructured-to-structured-data", in: ["text", "txt"], out: ["json", "csv"], kw: ["structure", "table", "parse", "extract", "json"], desc: "Turn messy text into clean JSON or CSV." },
  { src: ["11.14"], name: "AI Image Generator", in: ["text"], out: ["png"], model: "required", pop: 50, kw: ["generate image", "text to image", "art", "diffusion", "picture"], desc: "Generate an image from a text prompt (needs a capable local model)." },
  { src: ["11.15"], name: "AI Image Editor", in: ["image"], out: ["png"], model: "required", kw: ["edit image", "inpaint", "photo", "picture"], desc: "Edit an image by describing the change (needs a capable local model)." },
  { src: ["11.16"], name: "AI Background/Object Removal", slug: "ai-background-object-removal", in: ["image"], out: ["png"], model: "optional", kw: ["background", "object", "erase", "cutout", "photo"], desc: "Remove backgrounds or objects using an AI model." },
  ],
);
