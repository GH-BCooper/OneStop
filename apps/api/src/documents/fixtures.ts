// Test fixtures for the Word & PowerPoint tools (07-word-ppt-tools.md). Test-only: every file is
// generated in memory with the same libraries users' files are read with, so nothing is committed.
import {
  AlignmentType,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  Document,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";

export interface DocxFixture {
  title?: string;
  creator?: string;
  description?: string;
  keywords?: string;
  header?: string;
  /** Plain paragraphs, in order. A `#` prefix makes a Heading 1, `##` a Heading 2. */
  paragraphs?: string[];
  /** Insert a page break before every paragraph that starts with `>>`. */
  table?: string[][];
  image?: Uint8Array;
  imageSize?: [number, number];
  list?: string[];
  footnote?: string;
  comment?: { author: string; text: string };
}

export async function makeDocx(f: DocxFixture = {}): Promise<Uint8Array> {
  const children: (Paragraph | Table)[] = [];
  for (const p of f.paragraphs ?? ["Hello from a Word document."]) {
    if (p.startsWith("## "))
      children.push(new Paragraph({ text: p.slice(3), heading: HeadingLevel.HEADING_2 }));
    else if (p.startsWith("# "))
      children.push(new Paragraph({ text: p.slice(2), heading: HeadingLevel.HEADING_1 }));
    else if (p.startsWith(">>")) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
      children.push(new Paragraph({ text: p.slice(2).trim() }));
    } else children.push(new Paragraph({ text: p }));
  }
  if (f.footnote) {
    children.push(
      new Paragraph({
        children: [new TextRun("Footnoted sentence."), new FootnoteReferenceRun(1)],
      }),
    );
  }
  if (f.comment) {
    children.push(
      new Paragraph({
        children: [
          new CommentRangeStart(0),
          new TextRun("Commented text."),
          new CommentRangeEnd(0),
          new TextRun({ children: [new CommentReference(0)] }),
        ],
      }),
    );
  }
  for (const item of f.list ?? []) {
    children.push(new Paragraph({ text: item, numbering: { reference: "numbered", level: 0 } }));
  }
  if (f.table) {
    children.push(
      new Table({
        rows: f.table.map(
          (row) =>
            new TableRow({
              children: row.map((c) => new TableCell({ children: [new Paragraph(c)] })),
            }),
        ),
      }),
    );
  }
  if (f.image) {
    const [width, height] = f.imageSize ?? [200, 60];
    children.push(
      new Paragraph({
        children: [new ImageRun({ type: "png", data: f.image, transformation: { width, height } })],
      }),
    );
  }
  const doc = new Document({
    ...(f.title ? { title: f.title } : {}),
    ...(f.creator ? { creator: f.creator, lastModifiedBy: f.creator } : {}),
    ...(f.description ? { description: f.description } : {}),
    ...(f.keywords ? { keywords: f.keywords } : {}),
    numbering: {
      config: [
        {
          reference: "numbered",
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START },
          ],
        },
      ],
    },
    ...(f.footnote ? { footnotes: { 1: { children: [new Paragraph(f.footnote)] } } } : {}),
    ...(f.comment
      ? {
          comments: {
            children: [
              {
                id: 0,
                author: f.comment.author,
                initials: "JS",
                date: new Date("2024-01-02T03:04:05Z"),
                children: [new Paragraph(f.comment.text)],
              },
            ],
          },
        }
      : {}),
    sections: [
      {
        ...(f.header
          ? { headers: { default: new Header({ children: [new Paragraph(f.header)] }) } }
          : {}),
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

export interface PptxFixture {
  slides?: number;
  prefix?: string;
  title?: string;
  author?: string;
  notes?: boolean;
  numbers?: boolean;
  image?: Uint8Array;
  layout?: "LAYOUT_16x9" | "LAYOUT_4x3";
}

export async function makePptx(f: PptxFixture = {}): Promise<Uint8Array> {
  const pres = new PptxGenJS();
  pres.layout = f.layout ?? "LAYOUT_16x9";
  if (f.title) pres.title = f.title;
  if (f.author) pres.author = f.author;
  for (let i = 1; i <= (f.slides ?? 3); i += 1) {
    const slide = pres.addSlide();
    slide.addText(`${f.prefix ?? "Deck"} slide ${i}`, { x: 0.5, y: 0.5, w: 8, h: 1, fontSize: 28 });
    if (f.numbers !== false) slide.slideNumber = { x: 9, y: 5, fontSize: 10 };
    if (f.notes !== false) slide.addNotes(`${f.prefix ?? "Deck"} notes ${i}`);
    if (f.image) {
      slide.addImage({
        data: `data:image/png;base64,${Buffer.from(f.image).toString("base64")}`,
        x: 1,
        y: 2,
        w: 4,
        h: 2.5,
      });
    }
  }
  const out = (await pres.write({ outputType: "nodebuffer" })) as Buffer;
  return new Uint8Array(out);
}

/** A minimal but valid OpenDocument text file with metadata. */
export async function makeOdt({
  heading = "ODT Heading",
  paragraphs = ["First ODT paragraph.", "Second ODT paragraph."],
  author = "Olga Author",
  title = "ODT Title",
}: {
  heading?: string;
  paragraphs?: string[];
  author?: string;
  title?: string;
} = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", "application/vnd.oasis.opendocument.text", { compression: "STORE" });
  zip.file(
    "META-INF/manifest.xml",
    `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>`,
  );
  zip.file(
    "meta.xml",
    `<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.2"><office:meta><meta:generator>FixtureWriter/1.0</meta:generator><dc:title>${title}</dc:title><meta:initial-creator>${author}</meta:initial-creator><dc:creator>${author}</dc:creator><meta:creation-date>2024-01-02T03:04:05</meta:creation-date><meta:user-defined meta:name="Client">Acme Secret</meta:user-defined></office:meta></office:document-meta>`,
  );
  zip.file(
    "content.xml",
    `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:text><text:h text:outline-level="1">${heading}</text:h>${paragraphs.map((p) => `<text:p>${p}</text:p>`).join("")}</office:text></office:body></office:document-content>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

export const RTF_FIXTURE = new TextEncoder().encode(
  "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}{\\info{\\author Secret}}\\f0\\fs24 Hello RTF world.\\par Caf\\'e9 costs \\u8364? 5.\\par {\\*\\generator Fixture;}Last line.}",
);

/** A noisy (hard to compress) opaque picture, big enough that downscaling matters. */
export async function makeNoisyPng(width = 2400, height = 1600): Promise<Uint8Array> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const data = ctx.createImageData(width, height);
  let seed = 42;
  for (let i = 0; i < data.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const x = (i / 4) % width;
    data.data[i] = (x / width) * 255;
    data.data[i + 1] = seed & 0xff;
    data.data[i + 2] = 128;
    data.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

export const LONG_TEXT = `Solar power is changing how cities produce electricity. Over the last decade the cost of solar panels has fallen by more than eighty percent. Cities now install panels on schools, libraries and car parks.
The main challenge for solar power is storage. Electricity from solar panels is produced during the day, but demand peaks in the evening. Batteries store daytime solar power so cities can use it at night.
Battery prices are also falling quickly. Large battery projects now make solar power available around the clock in several cities. Engineers expect storage costs to halve again within ten years.
Some people worry about the land that solar farms use. Rooftop panels avoid this problem because they use space that already exists. Many cities now require new buildings to include rooftop solar panels.
Weather is another factor. Cloudy regions produce less solar power, so they combine solar with wind and hydro power. A mixed grid is more reliable than any single source.
In summary, cheaper panels and cheaper batteries are making solar power the default choice for cities. The remaining problems are storage at scale and planning the grid around changing weather.`;
