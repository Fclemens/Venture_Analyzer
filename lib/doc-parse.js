// Server-side text extraction for formats that don't need a model.

import mammoth from "mammoth";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { typeOf, extOf } from "./filetypes.js";

const MAX_CHARS = 400_000;
const MAX_SHEET_ROWS = 3000;
const MAX_ZIP_ENTRY = 20 * 1024 * 1024; // guards against zip bombs

const decodeXml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

async function zipText(zip, name) {
  const f = zip.file(name);
  if (!f) return "";
  const buf = await f.async("nodebuffer");
  if (buf.length > MAX_ZIP_ENTRY) throw new Error("File contents too large");
  return buf.toString("utf8");
}

// Paragraph-aware text from DrawingML: <a:p> groups of <a:t> runs
function drawingText(xml) {
  const paras = xml.match(/<a:p[ >][\s\S]*?<\/a:p>/g) || [];
  return paras
    .map(p => (p.match(/<a:t>([\s\S]*?)<\/a:t>/g) || []).map(t => decodeXml(t.replace(/<\/?a:t>/g, ""))).join(""))
    .map(t => t.trim())
    .filter(Boolean)
    .join("\n");
}

async function pptxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .map(n => n.match(/^ppt\/slides\/slide(\d+)\.xml$/)).filter(Boolean)
    .map(m => ({ n: Number(m[1]), name: m[0] })).sort((a, b) => a.n - b.n);
  const out = [];
  for (const s of slides) {
    const body = drawingText(await zipText(zip, s.name));
    const notes = drawingText(await zipText(zip, `ppt/notesSlides/notesSlide${s.n}.xml`));
    out.push(`--- Slide ${s.n} ---\n${body}${notes ? `\n[Speaker notes] ${notes}` : ""}`);
  }
  return out.join("\n\n");
}

async function xlsxText(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const out = [];
  let rows = 0;
  for (const ws of wb.worksheets) {
    out.push(`--- Sheet: ${ws.name} ---`);
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (rows++ > MAX_SHEET_ROWS) return;
      const cells = row.values.slice(1).map(v => {
        if (v === null || v === undefined) return "";
        if (typeof v === "object") return String(v.result ?? v.text ?? (v.richText ? v.richText.map(r => r.text).join("") : "") ?? "");
        return String(v);
      });
      out.push(cells.join(" | "));
    });
  }
  return out.join("\n");
}

// Returns the document's text, or null when the type needs the model (PDF/image)
export async function extractLocalText({ buffer, fileName }) {
  const type = typeOf(fileName);
  if (!type) throw new Error(`Unsupported file type: .${extOf(fileName)}`);
  if (type.kind !== "local") return null;
  let text;
  switch (extOf(fileName)) {
    case "docx": text = (await mammoth.extractRawText({ buffer })).value; break;
    case "pptx": text = await pptxText(buffer); break;
    case "xlsx": text = await xlsxText(buffer); break;
    default: text = buffer.toString("utf8");
  }
  text = text.replace(/\u0000/g, "").trim();
  if (!text) throw new Error("No readable text found in this file");
  return text.slice(0, MAX_CHARS);
}
