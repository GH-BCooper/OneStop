import { defineCategory } from "../define";

// Phase 21 (21-roadmap-expansion.md): the tools taken from docs/OneStop_Future_Roadmap.md Part 1.
//
// They are grouped by the category each one belongs to, not by the Features section its `src`
// points at, so the catalogue reads the way a person would look for them. Everything here follows
// the same contract as phases 05-17 — one entry, one route, accurate offline/network flags — and
// nothing here introduces a new runtime dependency (CLAUDE.md §2.1, §2.7).

/** PDF additions (roadmap §1.1). All pure `pdf-lib`/rasteriser work, so no network at all. */
export const pdfExpansionTools = defineCategory(
  "pdf",
  { phase: "21", sub: "Edit", status: "available" },
  [
    { src: ["1.27"], name: "PDF Redaction", in: ["pdf"], out: ["pdf"], pop: 45, kw: ["redact", "black out", "censor", "remove text", "privacy"], desc: "Permanently remove text or regions from a PDF, not just cover them up." },
    { src: ["1.28"], name: "PDF Bookmark Editor", sub: "Organize", in: ["pdf"], out: ["pdf", "json"], kw: ["outline", "table of contents", "toc", "bookmarks", "navigation"], desc: "Add, rename, reorder or delete a PDF's bookmarks and outline." },
    { src: ["1.29"], name: "PDF Chapter Splitter", sub: "Organize", in: ["pdf"], out: ["zip"], kw: ["split", "bookmarks", "chapters", "outline", "sections"], desc: "Split a PDF into one file per bookmark or chapter." },
    { src: ["1.30"], name: "PDF Booklet Layout", sub: "Organize", in: ["pdf"], out: ["pdf"], kw: ["imposition", "saddle stitch", "2-up", "print", "fold", "booklet"], desc: "Reorder and rotate pages for a print-shop folded booklet." },
    { src: ["1.31"], name: "PDF Table Extractor", sub: "Convert", in: ["pdf"], out: ["csv", "json"], pop: 40, kw: ["tables", "csv", "extract", "rows", "columns"], desc: "Pull just the tables out of a PDF as CSV or JSON." },
    { src: ["1.32"], name: "PDF Accessibility Checker", sub: "Secure", in: ["pdf"], out: ["json", "txt"], kw: ["pdf/ua", "accessibility", "tags", "alt text", "screen reader", "a11y"], desc: "Check a PDF against PDF/UA accessibility rules." },
    { src: ["1.33"], name: "PDF Visual Diff", sub: "Edit", in: ["pdf"], out: ["png", "zip"], batch: true, kw: ["compare", "redline", "difference", "overlay", "changes"], desc: "Highlight what changed between two PDFs as an image overlay." },
    { src: ["1.34"], name: "PDF Form Designer", sub: "Edit", in: ["pdf"], out: ["pdf"], kw: ["acroform", "fillable", "fields", "form builder"], desc: "Add fillable form fields to an existing PDF page." },
  ],
);

/** Word / PowerPoint additions (roadmap §1.2). */
export const documentExpansionTools = defineCategory(
  "documents",
  { phase: "21", sub: "Word / Document", status: "available" },
  [
    { src: ["2.16"], name: "Track Changes Cleaner", in: ["doc", "docx"], out: ["docx"], kw: ["tracked changes", "accept", "reject", "comments", "revisions"], desc: "Accept or reject every tracked change and drop the comments in a Word file." },
    { src: ["2.17"], name: "Markdown → Word", in: ["md", "text"], out: ["docx"], pop: 35, kw: ["md", "markdown", "docx", "convert"], desc: "Turn Markdown into a formatted Word document." },
    { src: ["2.18"], name: "Word → Markdown", in: ["doc", "docx"], out: ["md"], pop: 30, kw: ["md", "markdown", "plain text", "convert"], desc: "Convert a Word document into clean Markdown." },
    { src: ["2.19"], name: "Citation Formatter", in: ["text"], out: ["txt"], kw: ["apa", "mla", "chicago", "bibtex", "reference", "bibliography"], desc: "Reformat a reference list between APA, MLA, Chicago and BibTeX." },
    { src: ["2.20"], name: "Resume Template Filler", in: ["text"], out: ["docx", "pdf"], kw: ["cv", "resume", "template", "merge fields"], desc: "Fill a resume template from a short form and download it as Word or PDF." },
    { src: ["5.11"], name: "Markdown → Slides", sub: "PowerPoint", in: ["md", "text"], out: ["pptx"], kw: ["md", "deck", "presentation", "slides", "convert"], desc: "Turn a heading-delimited Markdown file into a PowerPoint deck." },
  ],
);

/** Data additions (roadmap §1.3). */
export const dataExpansionTools = defineCategory(
  "data",
  { phase: "21", sub: "Excel / Spreadsheet", status: "available" },
  [
    { src: ["3.21"], name: "Pivot Table Builder", in: ["csv", "xls", "xlsx"], out: ["csv", "xlsx"], pop: 35, kw: ["pivot", "group by", "aggregate", "summarise", "cross tab"], desc: "Group a sheet by rows and columns and aggregate the values." },
    { src: ["3.22"], name: "Chart Generator", in: ["csv", "xls", "xlsx"], out: ["svg", "png"], pop: 40, kw: ["chart", "graph", "bar", "line", "pie", "visualise", "plot"], desc: "Turn two columns of a sheet into a bar, line or pie chart." },
    { src: ["4.19"], name: "Data Diff", sub: "Data Conversion", in: ["csv", "json", "xls", "xlsx"], out: ["json", "csv"], batch: true, pop: 35, kw: ["compare", "difference", "changes", "added", "removed"], desc: "Compare two CSV or JSON files row by row and list what changed." },
    { src: ["4.20"], name: "JSON Schema Generator", sub: "Data Conversion", in: ["json", "text"], out: ["json"], kw: ["schema", "infer", "json schema", "types", "validate"], desc: "Infer a JSON Schema from one or more sample JSON files." },
    { src: ["4.21"], name: "Sample Data Generator", sub: "Data Conversion", in: [], out: ["csv", "json"], pop: 30, kw: ["fake data", "test data", "placeholder", "mock", "seed"], desc: "Generate realistic placeholder rows as CSV or JSON — no real personal data involved." },
  ],
);

/** Image additions (roadmap §1.4). */
export const imageExpansionTools = defineCategory(
  "images",
  { phase: "21", sub: "Enhance", status: "available" },
  [
    { src: ["6.29"], name: "Color Palette Extractor", in: ["image"], out: ["json", "png"], pop: 40, kw: ["palette", "dominant colors", "swatches", "hex", "theme"], desc: "Pull the dominant colours out of an image as hex swatches." },
    { src: ["6.30"], name: "Image → ASCII Art", sub: "Convert", in: ["image"], out: ["txt", "html"], kw: ["ascii", "text art", "terminal", "monospace"], desc: "Render an image as monospace text art." },
    { src: ["6.31"], name: "Favicon Set Generator", sub: "Convert", in: ["image"], out: ["zip"], pop: 40, kw: ["favicon", "app icon", "pwa", "ico", "apple touch"], desc: "Turn one image into a full favicon and app-icon set." },
    { src: ["6.32"], name: "Social Media Preset Resizer", sub: "Resize", in: ["image"], out: ["zip", "png", "jpg"], batch: true, pop: 45, kw: ["instagram", "youtube thumbnail", "open graph", "linkedin", "story", "crop"], desc: "Crop an image to Instagram, YouTube, Open Graph and LinkedIn sizes in one go." },
    { src: ["6.33"], name: "Collage Maker", sub: "Edit", in: ["image"], out: ["png", "jpg"], batch: true, pop: 35, kw: ["collage", "grid", "contact sheet", "montage", "combine"], desc: "Arrange several images into one grid or contact sheet." },
    { src: ["6.34"], name: "Batch Image Renamer", sub: "Edit", in: ["image"], out: ["zip"], batch: true, kw: ["rename", "sequential", "pattern", "bulk"], desc: "Rename a batch of images from a pattern like {name}-{n}." },
    { src: ["6.35"], name: "Sprite Sheet Generator", sub: "Edit", in: ["image"], out: ["zip", "png"], batch: true, kw: ["sprite", "atlas", "sheet", "game", "css sprites", "slice"], desc: "Pack images into one sprite sheet with a coordinate manifest, or slice one apart." },
    { src: ["6.36"], name: "Near-Duplicate Image Finder", sub: "Edit", in: ["image"], out: ["json"], batch: true, kw: ["duplicates", "similar", "phash", "perceptual hash", "dedupe"], desc: "Find visually similar images in a batch, not just byte-identical ones." },
    { src: ["6.37"], name: "Color Blindness Simulator", in: ["image"], out: ["png", "jpg", "zip"], batch: true, kw: ["protanopia", "deuteranopia", "tritanopia", "accessibility", "a11y", "colour blind"], desc: "See how an image looks to someone with colour-vision deficiency." },
    { src: ["6.38"], name: "Image Vectorizer", sub: "Convert", in: ["image"], out: ["svg"], pop: 35, kw: ["svg", "vector", "trace", "logo", "scalable"], desc: "Trace a bitmap logo or sketch into scalable SVG paths." },
    { src: ["6.39"], name: "Photo Map Viewer", in: ["image"], out: ["json"], batch: true, net: "optional", kw: ["exif", "gps", "map", "location", "coordinates", "geotag"], desc: "Read the GPS coordinates out of a batch of photos and map them." },
  ],
);

/** Audio additions (roadmap §1.5). */
export const audioExpansionTools = defineCategory(
  "audio",
  { phase: "21", sub: "Audio", status: "available" },
  [
    { src: ["7.14"], name: "Silence Trimmer", in: ["audio", "video"], out: ["audio"], batch: true, pop: 35, kw: ["silence", "dead air", "gaps", "podcast", "trim", "cut"], desc: "Cut the silent gaps out of a recording." },
    { src: ["7.15"], name: "Podcast Chapter Marker", in: ["audio", "video"], out: ["audio", "video"], kw: ["chapters", "markers", "timestamps", "podcast", "metadata"], desc: "Embed chapter markers from a timestamp list into an MP3 or MP4." },
    { src: ["7.16"], name: "Waveform Video Generator", in: ["audio"], out: ["mp4"], pop: 35, kw: ["waveform", "visualizer", "spectrum", "music video", "showwaves"], desc: "Render an audio file as a waveform animation video." },
    { src: ["7.17"], name: "Text to Speech Reader", in: ["text", "txt"], out: ["wav", "mp3"], pop: 40, net: "none", kw: ["tts", "narration", "voice", "read aloud", "audiobook", "piper"], desc: "Read text aloud with a local neural voice and save it as audio." },
    { src: ["7.18"], name: "Auto Subtitle Generator", in: ["audio", "video"], out: ["srt", "vtt", "txt"], pop: 55, net: "none", kw: ["subtitles", "captions", "transcribe", "speech to text", "whisper", "srt"], desc: "Transcribe speech in an audio or video file into subtitles, entirely on this machine." },
  ],
);

/** Video additions (roadmap §1.5). */
export const videoExpansionTools = defineCategory(
  "video",
  { phase: "21", sub: "Video", status: "available" },
  [
    { src: ["8.16"], name: "Video Stabilizer", in: ["video"], out: ["video"], pop: 35, kw: ["stabilise", "shaky", "smooth", "vidstab", "handheld"], desc: "Smooth out shaky handheld footage." },
    { src: ["8.17"], name: "Video Contact Sheet", in: ["video"], out: ["png", "jpg"], pop: 35, kw: ["thumbnail grid", "storyboard", "contact sheet", "preview", "frames"], desc: "One image showing a grid of frames sampled across a video." },
    { src: ["8.18"], name: "Subtitle Burner", in: ["video", "srt", "vtt", "ass"], out: ["video"], batch: true, pop: 40, kw: ["hardsub", "burn in", "captions", "srt", "vtt", "ass"], desc: "Burn a subtitle file permanently into the video picture." },
  ],
);

/** QR / barcode additions (roadmap §1.6). */
export const qrExpansionTools = defineCategory(
  "qr",
  { phase: "21", sub: "QR", status: "available" },
  [
    { src: ["10.16"], name: "Barcode Generator", in: ["text"], out: ["svg", "png"], pop: 40, kw: ["barcode", "code128", "ean13", "upc", "1d", "retail"], desc: "Generate a Code 128, EAN-13 or UPC-A barcode." },
    { src: ["10.17"], name: "Batch QR Generator", in: ["csv", "text"], out: ["zip"], pop: 35, kw: ["bulk", "mail merge", "many", "csv", "sheet"], desc: "One CSV column in, a ZIP of unique QR codes out." },
    { src: ["10.18"], name: "Logo QR Code", in: ["text"], out: ["png"], pop: 40, kw: ["logo", "branded", "center image", "custom"], desc: "Put a logo in the middle of a QR code and check it still scans." },
  ],
);

/** AI additions (roadmap §1.7). Same four-provider runtime as every other AI tool. */
export const aiExpansionTools = defineCategory(
  "ai",
  { phase: "21", sub: "Writing", net: "optional", status: "available" },
  [
    { src: ["11.17"], name: "AI Flashcard Generator", in: ["text", "pdf", "docx", "txt", "md"], out: ["json", "csv", "txt"], pop: 40, kw: ["flashcards", "quiz", "study", "anki", "revision", "q&a"], desc: "Turn a document into study flashcards and quiz questions." },
    { src: ["11.18"], name: "AI Code Explainer", sub: "Analysis", in: ["text", "any"], out: ["md", "txt"], pop: 45, kw: ["explain code", "review", "refactor", "comment", "understand"], desc: "Explain or review a code file in plain language." },
    { src: ["11.19"], name: "AI Resume Matcher", sub: "Analysis", in: ["text", "pdf", "docx"], out: ["md", "json"], pop: 35, kw: ["resume", "cv", "job description", "gaps", "match", "keywords"], desc: "Compare a resume against a job posting and list the gaps and matches." },
    { src: ["11.20"], name: "AI Alt-Text Generator", sub: "Images", in: ["image"], out: ["txt", "json"], batch: true, pop: 40, model: "optional", kw: ["alt text", "caption", "accessibility", "a11y", "describe image"], desc: "Draft alt text for an image — AI-generated, always worth a read before you use it." },
    { src: ["11.21"], name: "AI Meeting Summarizer", sub: "Analysis", in: ["audio", "video", "text", "srt", "vtt"], out: ["md", "txt"], pop: 45, kw: ["meeting", "lecture", "transcript", "minutes", "action items", "notes"], desc: "Transcribe a recording and summarise it into notes and action items." },
  ],
);

/** Developer / utility additions (roadmap §1.8). */
export const devExpansionTools = defineCategory(
  "dev-utility",
  { phase: "21", sub: "Developer / Utility", status: "available" },
  [
    { src: ["12.24"], name: "JWT Decoder", in: ["text"], out: ["json"], pop: 45, kw: ["jwt", "token", "bearer", "claims", "expiry", "hmac", "debug"], desc: "Decode a JWT's header and claims and check its expiry and signature." },
    { src: ["12.25"], name: "Color Converter", in: ["text"], out: ["json"], pop: 40, kw: ["hex", "rgb", "hsl", "cmyk", "contrast", "wcag", "palette", "colour"], desc: "Convert between HEX, RGB, HSL and CMYK, and check WCAG contrast." },
    { src: ["12.26"], name: "Cron Expression Builder", in: ["text"], out: ["json"], pop: 35, kw: ["cron", "crontab", "schedule", "explain", "next run"], desc: "Explain a cron expression in plain English and show its next runs." },
    { src: ["12.27"], name: "Text Diff Viewer", in: ["text", "txt", "any"], out: ["json", "html"], batch: true, pop: 45, kw: ["diff", "compare", "changes", "side by side", "patch", "code"], desc: "Compare two pieces of text or code line by line." },
    { src: ["12.28"], name: "Case Converter", in: ["text"], out: ["text"], pop: 40, kw: ["camelcase", "snake_case", "kebab-case", "title case", "constant", "slug"], desc: "Convert text between camelCase, snake_case, kebab-case, Title Case and more." },
    { src: ["12.29"], name: "Unit Converter", in: ["text"], out: ["json"], pop: 45, kw: ["convert", "length", "weight", "temperature", "area", "speed", "metric", "imperial"], desc: "Convert length, weight, temperature, area, volume, speed and data sizes." },
    { src: ["12.30"], name: "Lorem Ipsum Generator", in: [], out: ["text", "json", "png"], pop: 35, kw: ["lorem", "placeholder", "dummy text", "filler", "mock"], desc: "Generate placeholder text, JSON or labelled placeholder images." },
    { src: ["12.31"], name: "API Request Tester", in: ["url"], out: ["json"], net: "required", pop: 40, kw: ["http", "rest", "postman", "curl", "headers", "request", "api"], desc: "Send an HTTP request and inspect the response." },
    { src: ["12.32"], name: "Secrets Scanner", in: ["zip", "any"], out: ["json", "txt"], batch: true, pop: 35, kw: ["api key", "token", "leak", "credentials", "entropy", "security"], desc: "Scan files or a ZIP for accidentally committed keys and tokens." },
    { src: ["12.33"], name: "Readability Score Checker", in: ["text", "txt", "docx", "pdf"], out: ["json"], pop: 35, kw: ["flesch", "kincaid", "grade level", "reading ease", "readability"], desc: "Score how hard a piece of writing is to read." },
  ],
);

/** Network additions (roadmap §1.9). */
export const networkExpansionTools = defineCategory(
  "network",
  { phase: "21", sub: "Network / Information", net: "required", status: "available" },
  [
    { src: ["13.10"], name: "SSL Certificate Checker", in: ["text"], out: ["json"], pop: 40, kw: ["ssl", "tls", "certificate", "expiry", "issuer", "https", "chain"], desc: "Check a site's TLS certificate: issuer, expiry and chain." },
    { src: ["13.11"], name: "HTTP Security Header Grader", in: ["url"], out: ["json"], pop: 35, kw: ["csp", "hsts", "x-frame-options", "headers", "security", "grade"], desc: "Grade a URL's HTTP security headers." },
    { src: ["13.12"], name: "Sitemap and Robots Validator", in: ["url"], out: ["json"], kw: ["sitemap", "robots.txt", "seo", "crawl", "validate"], desc: "Fetch and lint a site's sitemap.xml and robots.txt." },
    { src: ["13.13"], name: "Email MX Validator", in: ["text"], out: ["json"], pop: 35, kw: ["email", "mx", "deliverable", "validate", "domain", "smtp"], desc: "Check an email address's syntax and whether its domain can receive mail." },
    { src: ["13.14"], name: "Weather Lookup", in: ["text"], out: ["json"], pop: 35, kw: ["weather", "forecast", "temperature", "rain", "open-meteo"], desc: "Current conditions and a short forecast for any place." },
  ],
);

/** Security & Privacy Toolkit (roadmap §1.10). */
export const securityTools = defineCategory(
  "security",
  { phase: "21", sub: "Security & Privacy", status: "available" },
  [
    { src: ["12.34"], name: "Password Strength Meter", in: ["text"], out: ["json"], pop: 45, kw: ["password", "strength", "entropy", "crack time", "weak"], desc: "Score a password's strength and say what would make it stronger." },
    { src: ["12.35"], name: "TOTP Code Generator", in: ["text"], out: ["json"], pop: 35, kw: ["2fa", "totp", "authenticator", "otp", "mfa", "google authenticator"], desc: "Generate and verify TOTP two-factor codes from a secret." },
    { src: ["12.36"], name: "Diceware Passphrase Generator", in: [], out: ["text"], pop: 40, kw: ["passphrase", "diceware", "words", "memorable", "xkcd"], desc: "Generate a memorable multi-word passphrase." },
    { src: ["12.37"], name: "File Encryptor", in: ["any"], out: ["any"], batch: true, pop: 40, kw: ["encrypt", "aes", "password", "secure", "private", "gcm"], desc: "Encrypt a file with AES-256-GCM and a password of your own." },
    { src: ["12.38"], name: "File Decryptor", in: ["any"], out: ["any"], batch: true, pop: 35, kw: ["decrypt", "aes", "password", "open", "gcm"], desc: "Decrypt a file that was encrypted with the File Encryptor." },
    { src: ["12.39"], name: "Breach Check", in: ["text"], out: ["json"], net: "required", pop: 40, kw: ["haveibeenpwned", "breach", "leaked", "pwned", "password"], desc: "Check whether a password appears in known breaches — only a hash prefix ever leaves this page." },
  ],
);

/** Finance & Math utilities (roadmap §1.10). */
export const financeTools = defineCategory(
  "finance",
  { phase: "21", sub: "Finance & Math", status: "available" },
  [
    { src: ["12.40"], name: "Loan Calculator", in: [], out: ["json", "csv"], pop: 40, kw: ["mortgage", "emi", "repayment", "amortisation", "interest", "loan"], desc: "Work out a loan's monthly payment and full amortisation schedule." },
    { src: ["12.41"], name: "Compound Interest Calculator", in: [], out: ["json", "csv"], pop: 35, kw: ["savings", "investment", "compound", "growth", "sip", "interest"], desc: "Project how savings grow with compound interest and regular contributions." },
    { src: ["12.42"], name: "Tip Splitter", in: [], out: ["json"], pop: 30, kw: ["tip", "bill", "split", "restaurant", "share"], desc: "Split a bill and tip between any number of people." },
    { src: ["12.43"], name: "Currency Converter", in: ["text"], out: ["json"], net: "required", pop: 45, kw: ["exchange rate", "forex", "usd", "eur", "convert money"], desc: "Convert between currencies at today's rate, with the last known rate as a fallback." },
    { src: ["12.44"], name: "Invoice Generator", in: [], out: ["pdf", "docx"], pop: 40, kw: ["invoice", "bill", "freelance", "receipt", "tax"], desc: "Fill in a few fields and download a tidy invoice as PDF or Word." },
  ],
);

/** Education & Reference (roadmap §1.10). */
export const educationTools = defineCategory(
  "education",
  { phase: "21", sub: "Education & Reference", status: "available" },
  [
    { src: ["12.45"], name: "Flashcard Maker", in: ["text", "csv"], out: ["csv", "html", "json"], pop: 30, kw: ["flashcards", "study", "anki", "revision", "cards", "print"], desc: "Turn a question-and-answer list into printable flashcards." },
    { src: ["12.46"], name: "Typing Speed Test", in: [], out: ["json"], pop: 35, kw: ["wpm", "typing", "speed", "accuracy", "practice"], desc: "Measure your typing speed and accuracy in your browser." },
  ],
);

/** Calendar & Time (roadmap §1.10). */
export const timeTools = defineCategory(
  "time",
  { phase: "21", sub: "Calendar & Time", status: "available" },
  [
    { src: ["12.47"], name: "World Clock Converter", in: ["text"], out: ["json"], pop: 40, kw: ["timezone", "time zone", "utc", "meeting", "world clock", "convert time"], desc: "See one moment in time across as many time zones as you like." },
    { src: ["12.48"], name: "Calendar Event Generator", in: [], out: ["ics"], pop: 35, kw: ["ics", "invite", "calendar", "event", "icalendar", "meeting"], desc: "Build a calendar invite you can send or import anywhere." },
    { src: ["12.49"], name: "Countdown Page Generator", in: [], out: ["html", "json"], pop: 30, kw: ["countdown", "timer", "launch", "shareable", "page"], desc: "Make a shareable countdown page — pair it with a QR code." },
  ],
);

/** Fun & Personal (roadmap §1.10). */
export const funTools = defineCategory(
  "fun",
  { phase: "21", sub: "Fun & Personal", status: "available" },
  [
    { src: ["12.50"], name: "Decision Maker", in: ["text"], out: ["json"], pop: 35, kw: ["random picker", "dice", "coin flip", "shuffle", "teams", "choose", "lottery"], desc: "Pick at random, roll dice, flip a coin or shuffle a list into teams." },
    { src: ["12.51"], name: "Year in OneStop", in: [], out: ["json"], auth: true, pop: 30, kw: ["wrap up", "stats", "usage", "recap", "year in review"], desc: "Your own OneStop year: top tools, busiest category and time saved." },
  ],
);

export const EXPANSION_TOOLS = [
  ...pdfExpansionTools,
  ...documentExpansionTools,
  ...dataExpansionTools,
  ...imageExpansionTools,
  ...audioExpansionTools,
  ...videoExpansionTools,
  ...qrExpansionTools,
  ...aiExpansionTools,
  ...devExpansionTools,
  ...networkExpansionTools,
  ...securityTools,
  ...financeTools,
  ...educationTools,
  ...timeTools,
  ...funTools,
];
