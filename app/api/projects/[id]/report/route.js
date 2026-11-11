import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { projectExists, getProjectById } from "@/lib/db";
import { rateLimit } from "@/lib/security";
import { submitReport, ensureWorker, REPORT_JOB } from "@/lib/jobs";
import { latestJob, activeJob, listSnapshots } from "@/lib/runs";

async function authorize(params) {
  const { userId } = await auth();
  if (!userId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { id } = await params;
  if (!projectExists(id, userId)) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { userId, projectId: id };
}

// GET            → { status, progress, error, snapshots } (cheap, for polling)
// GET ?full=1    → also the report itself (chapters + executive summary)
export async function GET(request, { params }) {
  try {
    const a = await authorize(params);
    if (a.error) return a.error;
    ensureWorker();
    const job = latestJob(a.projectId, REPORT_JOB);
    const status = !job ? "idle" : job.status === "queued" ? "running" : job.status === "running" ? "running" : job.status === "done" ? "done" : "error";
    const body = { status, progress: status === "running" ? job.progress || "Starting…" : null, error: status === "error" ? job.error : null, snapshots: listSnapshots(a.projectId) };
    if (new URL(request.url).searchParams.get("full") === "1") {
      const s = getProjectById(a.projectId)?.state || {};
      body.chapters = s.docChapters || {};
      body.execSummary = s.docExecSummary || null;
    }
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST → start generating the report in the background
export async function POST(_request, { params }) {
  try {
    const a = await authorize(params);
    if (a.error) return a.error;
    const rl = rateLimit(`report:${a.userId}`, { limit: 10 });
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry in ${rl.retryAfter}s.` }, { status: 429 });
    if (activeJob(a.projectId, REPORT_JOB)) return NextResponse.json({ error: "A report is already being generated." }, { status: 409 });
    submitReport({ projectId: a.projectId, userId: a.userId });
    return NextResponse.json({ status: "running", progress: "Starting…" }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
