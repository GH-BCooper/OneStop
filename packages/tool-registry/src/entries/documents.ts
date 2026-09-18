import { defineCategory } from "../define";

// Features §2 (Word / Document) and §5 (PowerPoint). PDF → PowerPoint (§5.2) lives in pdf.ts.
const word = defineCategory("documents", { phase: "07", sub: "Word / Document" }, [
  { src: ["2.1"], name: "Word → PDF", in: ["doc", "docx"], out: ["pdf"], batch: true, pop: 85, kw: ["docx", "doc", "convert"], status: "available", desc: "Convert a Word document to PDF." },
  { src: ["2.2"], name: "Word → Excel", in: ["doc", "docx"], out: ["xlsx"], kw: ["tables", "spreadsheet", "convert"], status: "available", desc: "Move the tables in a Word document into Excel." },
  { src: ["2.3"], name: "Word → Text", in: ["doc", "docx"], out: ["txt"], kw: ["extract text", "plain text"], status: "available", desc: "Extract the plain text from a Word document." },
  { src: ["2.4"], name: "Word → HTML", in: ["doc", "docx"], out: ["html"], kw: ["web page"], status: "available", desc: "Convert a Word document into clean HTML." },
  { src: ["2.5"], name: "Document → PDF", in: ["doc", "docx", "odt", "rtf", "txt"], out: ["pdf"], batch: true, pop: 50, kw: ["odt", "rtf", "txt", "convert"], status: "available", desc: "Convert Word, ODT, RTF or text documents to PDF." },
  { src: ["2.6"], name: "Document → Images", in: ["doc", "docx", "odt", "rtf", "txt"], out: ["png", "jpg"], kw: ["picture", "export pages"], status: "available", desc: "Render each page of a document as an image." },
  { src: ["2.7"], name: "Merge Documents", in: ["doc", "docx"], out: ["docx"], batch: true, kw: ["combine", "join", "word"], status: "available", desc: "Combine several Word documents into one." },
  { src: ["2.8"], name: "Split Documents", in: ["doc", "docx"], out: ["docx", "zip"], kw: ["separate", "divide", "word"], status: "available", desc: "Split a Word document into smaller documents." },
  { src: ["2.9"], name: "Compress Documents", in: ["doc", "docx"], out: ["docx"], batch: true, kw: ["shrink", "reduce size", "smaller", "word"], status: "available", desc: "Shrink Word documents by optimizing embedded images." },
  { src: ["2.10"], name: "OCR → Word", in: ["pdf", "image"], out: ["docx"], pop: 40, kw: ["scan", "scanned", "recognize text", "editable"], status: "available", desc: "Turn a scanned PDF or photo of text into an editable Word document." },
  { src: ["2.11"], name: "Document Translator", in: ["doc", "docx", "txt"], out: ["docx", "txt"], kw: ["translate", "language", "spanish", "french", "german", "italian", "portuguese"], status: "available", desc: "Translate a document into another language." },
  { src: ["2.12"], name: "Grammar Checker", in: ["text", "txt", "docx", "doc", "odt", "rtf"], out: ["txt"], kw: ["spelling", "proofread"], status: "available", desc: "Find grammar, spelling and style problems in text." },
  { src: ["2.13"], name: "Text Formatter", in: ["text", "txt"], out: ["txt"], kw: ["case", "whitespace", "clean up text", "tidy"], status: "available", desc: "Clean up text: fix spacing, line breaks and letter case." },
  { src: ["2.14"], name: "Document Summarizer", in: ["doc", "docx", "odt", "rtf", "txt", "pdf"], out: ["txt"], kw: ["summary", "tldr", "key points"], status: "available", desc: "Get a short summary of a long document." },
  { src: ["2.15"], name: "Document Metadata Viewer/Remover", slug: "document-metadata", in: ["doc", "docx", "odt"], out: ["json", "docx", "odt"], kw: ["properties", "author", "strip", "privacy"], status: "available", desc: "View or strip the hidden properties of a document." },
]);

const powerpoint = defineCategory("documents", { phase: "07", sub: "PowerPoint" }, [
  { src: ["5.1"], name: "PowerPoint → PDF", in: ["ppt", "pptx"], out: ["pdf"], batch: true, pop: 65, kw: ["ppt", "pptx", "slides", "presentation", "convert"], status: "available", desc: "Convert a PowerPoint presentation to PDF." },
  { src: ["5.3"], name: "PowerPoint → Images", in: ["ppt", "pptx"], out: ["png", "jpg"], kw: ["ppt", "pptx", "slides", "picture", "export"], status: "available", desc: "Export each slide as an image." },
  { src: ["5.4"], name: "PowerPoint → Text", in: ["ppt", "pptx"], out: ["txt"], kw: ["ppt", "pptx", "slides", "extract text"], status: "available", desc: "Extract the text from every slide." },
  { src: ["5.5"], name: "Merge Presentations", in: ["ppt", "pptx"], out: ["pptx"], batch: true, kw: ["combine", "join", "slides", "ppt"], status: "available", desc: "Combine several presentations into one." },
  { src: ["5.6"], name: "Split Presentation", in: ["ppt", "pptx"], out: ["pptx", "zip"], kw: ["separate", "slides", "ppt"], status: "available", desc: "Split a presentation into smaller decks." },
  { src: ["5.7"], name: "Compress Presentation", in: ["ppt", "pptx"], out: ["pptx"], batch: true, kw: ["shrink", "reduce size", "slides", "ppt"], status: "available", desc: "Make a presentation smaller by optimizing its media." },
  { src: ["5.8"], name: "Extract Slides", in: ["ppt", "pptx"], out: ["pptx"], kw: ["pull out", "select slides", "ppt"], status: "available", desc: "Copy selected slides into a new presentation." },
  { src: ["5.9"], name: "Rearrange Slides", in: ["ppt", "pptx"], out: ["pptx"], kw: ["reorder", "sort", "move slides", "ppt"], status: "available", desc: "Change the order of slides in a presentation." },
  { src: ["5.10"], name: "Remove Slides", in: ["ppt", "pptx"], out: ["pptx"], kw: ["delete slides", "drop", "ppt"], status: "available", desc: "Delete unwanted slides from a presentation." },
]);

export const documentTools = [...word, ...powerpoint];
