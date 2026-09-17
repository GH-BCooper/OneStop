import { defineCategory } from "../define";

// Features §2 (Word / Document) and §5 (PowerPoint). PDF → PowerPoint (§5.2) lives in pdf.ts.
const word = defineCategory("documents", { phase: "07", sub: "Word / Document" }, [
  { src: ["2.1"], name: "Word → PDF", in: ["doc", "docx"], out: ["pdf"], batch: true, pop: 85, kw: ["docx", "doc", "convert"], desc: "Convert a Word document to PDF." },
  { src: ["2.2"], name: "Word → Excel", in: ["doc", "docx"], out: ["xlsx"], kw: ["tables", "spreadsheet", "convert"], desc: "Move the tables in a Word document into Excel." },
  { src: ["2.3"], name: "Word → Text", in: ["doc", "docx"], out: ["txt"], kw: ["extract text", "plain text"], desc: "Extract the plain text from a Word document." },
  { src: ["2.4"], name: "Word → HTML", in: ["doc", "docx"], out: ["html"], kw: ["web page"], desc: "Convert a Word document into clean HTML." },
  { src: ["2.5"], name: "Document → PDF", in: ["doc", "docx", "odt", "rtf", "txt"], out: ["pdf"], batch: true, pop: 50, kw: ["odt", "rtf", "txt", "convert"], desc: "Convert Word, ODT, RTF or text documents to PDF." },
  { src: ["2.6"], name: "Document → Images", in: ["doc", "docx", "odt", "rtf"], out: ["png", "jpg"], kw: ["picture", "export pages"], desc: "Render each page of a document as an image." },
  { src: ["2.7"], name: "Merge Documents", in: ["doc", "docx"], out: ["docx"], batch: true, kw: ["combine", "join", "word"], desc: "Combine several Word documents into one." },
  { src: ["2.8"], name: "Split Documents", in: ["doc", "docx"], out: ["docx", "zip"], kw: ["separate", "divide", "word"], desc: "Split a Word document into smaller documents." },
  { src: ["2.9"], name: "Compress Documents", in: ["doc", "docx"], out: ["docx"], batch: true, kw: ["shrink", "reduce size", "smaller", "word"], desc: "Shrink Word documents by optimizing embedded images." },
  { src: ["2.10"], name: "OCR → Word", in: ["pdf", "image"], out: ["docx"], pop: 40, kw: ["scan", "scanned", "recognize text", "editable"], desc: "Turn a scanned PDF or photo of text into an editable Word document." },
  { src: ["2.11"], name: "Document Translator", in: ["doc", "docx", "txt"], out: ["docx", "txt"], net: "optional", kw: ["translate", "language"], desc: "Translate a document into another language." },
  { src: ["2.12"], name: "Grammar Checker", in: ["text", "txt", "docx"], out: ["txt"], kw: ["spelling", "proofread"], desc: "Find grammar, spelling and style problems in text." },
  { src: ["2.13"], name: "Text Formatter", in: ["text", "txt"], out: ["txt"], kw: ["case", "whitespace", "clean up text", "tidy"], desc: "Clean up text: fix spacing, line breaks and letter case." },
  { src: ["2.14"], name: "Document Summarizer", in: ["doc", "docx", "txt", "pdf"], out: ["txt"], kw: ["summary", "tldr", "key points"], desc: "Get a short summary of a long document." },
  { src: ["2.15"], name: "Document Metadata Viewer/Remover", slug: "document-metadata", in: ["doc", "docx", "odt"], out: ["json", "docx"], kw: ["properties", "author", "strip", "privacy"], desc: "View or strip the hidden properties of a document." },
]);

const powerpoint = defineCategory("documents", { phase: "07", sub: "PowerPoint" }, [
  { src: ["5.1"], name: "PowerPoint → PDF", in: ["ppt", "pptx"], out: ["pdf"], batch: true, pop: 65, kw: ["ppt", "pptx", "slides", "presentation", "convert"], desc: "Convert a PowerPoint presentation to PDF." },
  { src: ["5.3"], name: "PowerPoint → Images", in: ["ppt", "pptx"], out: ["png", "jpg"], kw: ["ppt", "pptx", "slides", "picture", "export"], desc: "Export each slide as an image." },
  { src: ["5.4"], name: "PowerPoint → Text", in: ["ppt", "pptx"], out: ["txt"], kw: ["ppt", "pptx", "slides", "extract text"], desc: "Extract the text from every slide." },
  { src: ["5.5"], name: "Merge Presentations", in: ["ppt", "pptx"], out: ["pptx"], batch: true, kw: ["combine", "join", "slides", "ppt"], desc: "Combine several presentations into one." },
  { src: ["5.6"], name: "Split Presentation", in: ["ppt", "pptx"], out: ["pptx", "zip"], kw: ["separate", "slides", "ppt"], desc: "Split a presentation into smaller decks." },
  { src: ["5.7"], name: "Compress Presentation", in: ["ppt", "pptx"], out: ["pptx"], kw: ["shrink", "reduce size", "slides", "ppt"], desc: "Make a presentation smaller by optimizing its media." },
  { src: ["5.8"], name: "Extract Slides", in: ["ppt", "pptx"], out: ["pptx"], kw: ["pull out", "select slides", "ppt"], desc: "Copy selected slides into a new presentation." },
  { src: ["5.9"], name: "Rearrange Slides", in: ["ppt", "pptx"], out: ["pptx"], kw: ["reorder", "sort", "move slides", "ppt"], desc: "Change the order of slides in a presentation." },
  { src: ["5.10"], name: "Remove Slides", in: ["ppt", "pptx"], out: ["pptx"], kw: ["delete slides", "drop", "ppt"], desc: "Delete unwanted slides from a presentation." },
]);

export const documentTools = [...word, ...powerpoint];
