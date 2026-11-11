// Word (.docx) and Markdown exports of the finished report.

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType,
} from "docx";

// ── Markdown → docx ──────────────────────────────────────────────────────────

// **bold**, *italic*, `code` inside one line
export function inlineRuns(text, base = {}) {
  const runs = [];
  const re = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push(new TextRun({ ...base, text: text.slice(last, m.index) }));
    const t = m[0];
    if (t.startsWith("***")) runs.push(new TextRun({ ...base, text: t.slice(3, -3), bold: true, italics: true }));
    else if (t.startsWith("**")) runs.push(new TextRun({ ...base, text: t.slice(2, -2), bold: true }));
    else if (t.startsWith("`")) runs.push(new TextRun({ ...base, text: t.slice(1, -1), font: "Consolas" }));
    else runs.push(new TextRun({ ...base, text: t.slice(1, -1), italics: true }));
    last = m.index + t.length;
  }
  if (last < text.length) runs.push(new TextRun({ ...base, text: text.slice(last) }));
  return runs.length ? runs : [new TextRun({ ...base, text: "" })];
}

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "D1D5DB" };
const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

function makeTable(rows) {
  const cols = Math.max(...rows.map(r => r.length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((cells, ri) => new TableRow({
      tableHeader: ri === 0,
      children: Array.from({ length: cols }, (_, ci) => new TableCell({
        borders,
        shading: ri === 0 ? { type: ShadingType.CLEAR, fill: "F3F4F6", color: "auto" } : undefined,
        margins: { top: 40, bottom: 40, left: 80, right: 80 },
        children: [new Paragraph({ children: inlineRuns(cells[ci] ?? "", { size: 18, bold: ri === 0 }) })],
      })),
    })),
  });
}

const splitRow = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());

export function markdownToDocx(md, { shiftHeadings = 0 } = {}) {
  const out = [];
  const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
  let i = 0, para = [];
  const flush = () => {
    if (para.length) out.push(new Paragraph({ children: inlineRuns(para.join(" ")), spacing: { after: 120 } }));
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    let m;
    if (!t) { flush(); i++; continue; }
    if ((m = t.match(/^(#{1,4})\s+(.*)$/))) {
      flush();
      const level = Math.min(m[1].length + shiftHeadings, 4);
      out.push(new Paragraph({ heading: HEADINGS[level - 1], children: inlineRuns(m[2]), spacing: { before: 200, after: 80 } }));
      i++; continue;
    }
    if (/^---+$/.test(t)) { flush(); out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "D1D5DB", space: 1 } }, spacing: { after: 120 } })); i++; continue; }
    if (t.startsWith("|") && lines[i + 1]?.trim().match(/^\|?\s*:?-{2,}/)) {
      flush();
      const rows = [splitRow(t)];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(splitRow(lines[i++]));
      out.push(makeTable(rows));
      out.push(new Paragraph({ spacing: { after: 120 } }));
      continue;
    }
    if ((m = t.match(/^([-*•])\s+(.*)$/))) {
      flush();
      const indent = Math.min(2, Math.floor((line.length - line.trimStart().length) / 2));
      out.push(new Paragraph({ children: inlineRuns(m[2]), bullet: { level: indent }, spacing: { after: 60 } }));
      i++; continue;
    }
    if ((m = t.match(/^(\d+)[.)]\s+(.*)$/))) {
      flush();
      out.push(new Paragraph({ children: [new TextRun({ text: `${m[1]}. ` }), ...inlineRuns(m[2])], indent: { left: 360, hanging: 260 }, spacing: { after: 60 } }));
      i++; continue;
    }
    if (t.startsWith(">")) {
      flush();
      out.push(new Paragraph({ children: inlineRuns(t.replace(/^>\s?/, ""), { italics: true, color: "4B5563" }), indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: "9CA3AF", space: 8 } }, spacing: { after: 100 } }));
      i++; continue;
    }
    para.push(t);
    i++;
  }
  flush();
  return out;
}

// ── Report assembly ──────────────────────────────────────────────────────────

const P = (text, opts = {}) => new Paragraph({ children: inlineRuns(String(text ?? ""), opts.run), spacing: { after: 120 }, ...opts.para });
const H = (text, level = 2) => new Paragraph({ heading: HEADINGS[level - 1], children: [new TextRun(String(text))], spacing: { before: 240, after: 100 } });
const bullets = (list) => (list || []).map(t => new Paragraph({ children: inlineRuns(String(t)), bullet: { level: 0 }, spacing: { after: 60 } }));

export async function buildDocx({ p0, execSummary, chapters = {}, passDefs = [], finDigest = "", appendix = [] }) {
  const kids = [];
  kids.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(p0?.venture_name || "Venture analysis")] }));
  kids.push(P([new Date().toISOString().slice(0, 10), p0?.stage, p0?.classification?.business_model?.toUpperCase()].filter(Boolean).join("  ·  "), { run: { color: "6B7280", size: 20 } }));

  if (execSummary) {
    kids.push(H("Executive summary", 1));
    kids.push(new Paragraph({ children: [new TextRun({ text: execSummary.verdict || "", bold: true, size: 32 }), new TextRun({ text: `    ${execSummary.score || ""}`, size: 32 })], spacing: { after: 80 } }));
    if (execSummary.score_rationale) kids.push(P(execSummary.score_rationale, { run: { italics: true, color: "6B7280" } }));
    if (execSummary.investment_thesis) kids.push(P(execSummary.investment_thesis, { run: { italics: true } }));
    kids.push(...markdownToDocx(execSummary.executive_summary, { shiftHeadings: 1 }));

    if (execSummary.score_breakdown?.length) {
      kids.push(H("Score breakdown", 2));
      kids.push(makeTable([
        ["Dimension", "Weight", "Score", "Confidence", "Basis"],
        ...execSummary.score_breakdown.map(d => [d.label, `${Math.round(d.weight * 100)}%`, d.score ?? "n/a", d.confidence || "", (d.evidence || []).join("; ")]),
      ].map(r => r.map(String))));
    }
    for (const [title, list] of [["Key findings", execSummary.strongest_findings], ["Key risks", execSummary.key_risks], ["Tensions across the analysis", execSummary.tensions]]) {
      if (list?.length) { kids.push(H(title, 2)); kids.push(...bullets(list)); }
    }
    if (execSummary.recommendation) { kids.push(H("Recommendation", 2)); kids.push(P(execSummary.recommendation)); }
    if (execSummary.founder_questions?.length) {
      kids.push(H("Questions for the founders", 2));
      execSummary.founder_questions.forEach((q, i) => kids.push(new Paragraph({ children: [new TextRun({ text: `${i + 1}. ` }), ...inlineRuns(String(q))], indent: { left: 360, hanging: 260 }, spacing: { after: 60 } })));
    }
  }
  if (finDigest) {
    kids.push(H("Financial model (calculated)", 2));
    finDigest.split("\n").forEach(l => kids.push(P(l)));
  }
  for (const pd of passDefs) {
    if (!chapters[pd.id]) continue;
    kids.push(new Paragraph({ children: [], pageBreakBefore: true }));
    kids.push(H(`P${pd.num} · ${pd.title}`, 1));
    kids.push(...markdownToDocx(chapters[pd.id], { shiftHeadings: 1 }));
  }
  if (appendix.length) {
    kids.push(new Paragraph({ children: [], pageBreakBefore: true }));
    kids.push(H("Appendix: full analyses", 1));
    for (const a of appendix) { kids.push(H(a.title, 2)); kids.push(...markdownToDocx(a.text, { shiftHeadings: 2 })); }
  }

  const doc = new Document({
    creator: "Venture Analyzer",
    title: p0?.venture_name || "Venture analysis",
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{ children: kids }],
  });
  return Packer.toBuffer(doc);
}

export function buildMarkdown({ p0, execSummary, chapters = {}, passDefs = [], finDigest = "" }) {
  let md = `# ${p0?.venture_name || "Venture analysis"}\n\n*${new Date().toISOString().slice(0, 10)}${p0?.stage ? " · " + p0.stage : ""}*\n\n`;
  if (execSummary) {
    md += `## Executive summary\n\n**${execSummary.verdict || ""}** — ${execSummary.score || ""}\n\n${execSummary.score_rationale ? `*${execSummary.score_rationale}*\n\n` : ""}`;
    if (execSummary.investment_thesis) md += `> ${execSummary.investment_thesis}\n\n`;
    md += `${execSummary.executive_summary || ""}\n\n`;
    if (execSummary.score_breakdown?.length) {
      md += `### Score breakdown\n\n| Dimension | Weight | Score | Confidence | Basis |\n|---|---|---|---|---|\n`;
      execSummary.score_breakdown.forEach(d => { md += `| ${d.label} | ${Math.round(d.weight * 100)}% | ${d.score ?? "n/a"} | ${d.confidence || ""} | ${(d.evidence || []).join("; ").replace(/\|/g, "/")} |\n`; });
      md += "\n";
    }
    for (const [title, list] of [["Key findings", execSummary.strongest_findings], ["Key risks", execSummary.key_risks], ["Tensions across the analysis", execSummary.tensions]]) {
      if (list?.length) md += `### ${title}\n\n${list.map(t => `- ${t}`).join("\n")}\n\n`;
    }
    if (execSummary.recommendation) md += `### Recommendation\n\n${execSummary.recommendation}\n\n`;
    if (execSummary.founder_questions?.length) md += `### Questions for the founders\n\n${execSummary.founder_questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\n`;
  }
  if (finDigest) md += `## Financial model (calculated)\n\n${finDigest.split("\n").map(l => `- ${l}`).join("\n")}\n\n`;
  for (const pd of passDefs) if (chapters[pd.id]) md += `---\n\n# P${pd.num} · ${pd.title}\n\n${chapters[pd.id]}\n\n`;
  return md;
}
