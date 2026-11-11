import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { extractLocalText } from "../lib/doc-parse.js";
import { buildDocx } from "../lib/export-docx.js";
import { buildWorkbook } from "../lib/export-xlsx.js";
import { typeOf, UPLOAD_PATTERN, ACCEPT_ATTR } from "../lib/filetypes.js";

test("file type registry: kinds, pattern and accept attribute agree", () => {
  assert.equal(typeOf("Deck.PDF").kind, "model");
  assert.equal(typeOf("model.xlsx").kind, "local");
  assert.equal(typeOf("evil.exe"), null);
  assert.ok(UPLOAD_PATTERN.test("x.PPTX") && !UPLOAD_PATTERN.test("x.exe"));
  assert.ok(ACCEPT_ATTR.includes(".docx") && ACCEPT_ATTR.includes(".md"));
});

test("plain text, csv and markdown are decoded", async () => {
  assert.equal(await extractLocalText({ buffer: Buffer.from("a,b\n1,2\n"), fileName: "d.csv" }), "a,b\n1,2");
  assert.match(await extractLocalText({ buffer: Buffer.from("# Title\nbody"), fileName: "n.md" }), /# Title/);
});

test("docx: text, headings and table cells are extracted", async () => {
  const buf = await buildDocx({ p0: { venture_name: "Acme" }, execSummary: { verdict: "Invest", score: "8/10", executive_summary: "Strong **team**.", founder_questions: [] }, chapters: { p2: "| Seg | Size |\n|---|---|\n| EU | €2bn |" }, passDefs: [{ id: "p2", num: 2, title: "Market" }] });
  const text = await extractLocalText({ buffer: buf, fileName: "report.docx" });
  for (const n of ["Acme", "Invest", "Strong team.", "EU", "€2bn"]) assert.ok(text.includes(n), n);
});

test("xlsx: sheets and cell values (including formula results) are extracted", async () => {
  const buf = await buildWorkbook({ finModel: { currency: "EUR", assumptions: { arpa_month: { value: 100 }, gross_margin_pct: { value: 80 }, cac: { value: 400 }, monthly_churn_pct: { value: 5 }, new_customers_start: { value: 50 }, fixed_costs_month: { value: 10000 }, cash_start: { value: 100000 } } } });
  const text = await extractLocalText({ buffer: buf, fileName: "model.xlsx" });
  assert.match(text, /--- Sheet: Assumptions ---/);
  assert.match(text, /Revenue per customer \/ month \| 100/);
  assert.match(text, /--- Sheet: Model Base ---/);
});

test("pptx: slide text in order, with speaker notes and XML entities decoded", async () => {
  const zip = new JSZip();
  const slide = (t) => `<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  zip.file("ppt/slides/slide2.xml", slide("Market &amp; size: $5bn"));
  zip.file("ppt/slides/slide1.xml", slide("Our <b>vision</b>".replace("<b>", "").replace("</b>", "")));
  zip.file("ppt/notesSlides/notesSlide2.xml", slide("say the TAM twice"));
  const text = await extractLocalText({ buffer: await zip.generateAsync({ type: "nodebuffer" }), fileName: "deck.pptx" });
  assert.ok(text.indexOf("Slide 1") < text.indexOf("Slide 2"), "ordered by slide number");
  assert.match(text, /Market & size: \$5bn/);
  assert.match(text, /\[Speaker notes\] say the TAM twice/);
});

test("PDFs/images return null (model path); unsupported and empty files are rejected clearly", async () => {
  assert.equal(await extractLocalText({ buffer: Buffer.from("%PDF"), fileName: "d.pdf" }), null);
  await assert.rejects(extractLocalText({ buffer: Buffer.from("x"), fileName: "a.exe" }), /Unsupported/);
  await assert.rejects(extractLocalText({ buffer: Buffer.from("   "), fileName: "e.txt" }), /No readable text/);
  await assert.rejects(extractLocalText({ buffer: Buffer.from("not a zip"), fileName: "bad.docx" }));
});
