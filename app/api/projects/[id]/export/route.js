import { NextResponse } from "next/server";
import { authorizeProject } from "@/lib/access";
import { loadProjectForClient, listRuns } from "@/lib/runs";
import { PASS_DEFS } from "@/lib/constants";
import { runModel, describeModel } from "@/lib/finmodel";
import { buildWorkbook } from "@/lib/export-xlsx";
import { buildDocx, buildMarkdown } from "@/lib/export-docx";
import { METHODOLOGY_REGISTRY } from "@/lib/registry";

const TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md:   "text/markdown; charset=utf-8",
};

const safeName = (s) => String(s || "report").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "report";

// GET /api/projects/:id/export?format=xlsx|docx|md[&appendix=1]
export async function GET(request, { params }) {
  try {
    const a = await authorizeProject(params);
    if (a.error) return a.error;
    const { projectId: id, userId, orgId } = a;

    const url = new URL(request.url);
    const format = url.searchParams.get("format") || "docx";
    if (!TYPES[format]) return NextResponse.json({ error: "Unknown format" }, { status: 400 });

    const project = loadProjectForClient(id, userId, orgId);
    const s = project.state || {};
    const runs = Object.fromEntries(listRuns(id, { full: true }).map(r => [r.method_id, r]));
    const model = s.finModel ? runModel(s.finModel.assumptions, s.finModel.scenarios) : null;
    const finDigest = describeModel(model, s.finModel?.currency ? s.finModel.currency + " " : "");
    const base = safeName(s.p0?.venture_name || project.name);

    let body;
    if (format === "xlsx") {
      body = await buildWorkbook({
        p0: s.p0, execSummary: s.docExecSummary, finModel: s.finModel, entities: s.entities,
        sources: s.sources || [], methods: s.methods || [], runs, methodSummaries: s.methodSummaries || {},
      });
    } else {
      const input = { p0: s.p0, execSummary: s.docExecSummary, chapters: s.docChapters || {}, passDefs: PASS_DEFS.slice(1), finDigest };
      if (format === "docx") {
        const appendix = url.searchParams.get("appendix") === "1"
          ? (s.methods || []).filter(m => m.decision !== "skip" && runs[m.id]?.result).map(m => ({ title: METHODOLOGY_REGISTRY[m.id]?.name || m.id, text: runs[m.id].result }))
          : [];
        body = await buildDocx({ ...input, appendix });
      } else {
        body = buildMarkdown(input);
      }
    }
    return new Response(body, {
      headers: {
        "Content-Type": TYPES[format],
        "Content-Disposition": `attachment; filename="${base}.${format}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
