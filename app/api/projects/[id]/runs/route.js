import { NextResponse } from "next/server";
import { authorizeProject } from "@/lib/access";
import { METHODOLOGY_REGISTRY } from "@/lib/registry";
import { rateLimit } from "@/lib/security";
import { ensureWorker, submitJob } from "@/lib/jobs";
import {
  getRun, listRuns, saveRun, chunkStats, listWebSources, listVersions, getVersion, appendVersion, jobCounts, projectUsage, cancelQueuedJob, activeJob, recordEvent,
} from "@/lib/runs";

// Method runs are queued server-side. The browser enqueues work and polls;
// closing the tab does not stop a run.

const authorize = (params) => authorizeProject(params);

// GET /runs                → lightweight status of every method + chunk counts (polling)
// GET /runs?full=1         → every run including evidence and results (initial load)
// GET /runs?method=<id>    → one run in full, with the web sources it discovered
// GET /runs?method=<id>&history=1 → also every saved version of the result
export async function GET(request, { params }) {
  try {
    const a = await authorize(params);
    if (a.error) return a.error;
    ensureWorker(); // resumes interrupted work if the server restarted
    const url = new URL(request.url);
    const methodId = url.searchParams.get("method");

    if (methodId) {
      const run = getRun(a.projectId, methodId);
      if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({
        run,
        webSources: listWebSources(a.projectId, methodId),
        ...(url.searchParams.get("history") ? { versions: listVersions(a.projectId, methodId) } : {}),
        chunks: chunkStats(a.projectId),
      });
    }

    const full = url.searchParams.get("full") === "1";
    const runs = Object.fromEntries(listRuns(a.projectId, { full }).map(r => [r.method_id, r]));
    return NextResponse.json({ runs, chunks: chunkStats(a.projectId), jobs: jobCounts(), usage: projectUsage(a.projectId) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

const ACTIONS = new Set(["extract", "execute", "revise", "approve", "restore", "run", "cancel"]);

// POST { action: "extract" | "execute" | "revise" | "approve" | "restore", methodId, notes?, versionId? }
export async function POST(request, { params }) {
  try {
    const a = await authorize(params);
    if (a.error) return a.error;

    const rl = rateLimit(`runs:${a.userId}`, { limit: 60 });
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry in ${rl.retryAfter}s.` }, { status: 429 });

    const { action, methodId, notes, versionId } = await request.json();
    if (!ACTIONS.has(action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    if (!METHODOLOGY_REGISTRY[methodId]) return NextResponse.json({ error: "Unknown methodology" }, { status: 400 });

    const run = getRun(a.projectId, methodId);

    if (action === "approve") {
      if (!run?.result) return NextResponse.json({ error: "Nothing to approve yet" }, { status: 400 });
      if (run.status === "extracting" || run.status === "executing") return NextResponse.json({ error: "Method is still running" }, { status: 409 });
      const approved = saveRun(a.projectId, methodId, { status: "done", error: null });
      recordEvent(a.projectId, a.userId, "approve", methodId);
      return NextResponse.json({ run: approved });
    }
    if (action === "cancel") {
      if (cancelQueuedJob(a.projectId, methodId)) return NextResponse.json({ run: getRun(a.projectId, methodId, { full: false }) });
      if (activeJob(a.projectId, methodId)) return NextResponse.json({ error: "This step is already running and will finish on its own." }, { status: 409 });
      return NextResponse.json({ error: "Nothing to cancel" }, { status: 400 });
    }
    if (action === "restore") {
      if (run && (run.status === "extracting" || run.status === "executing")) return NextResponse.json({ error: "Method is still running" }, { status: 409 });
      const v = getVersion(a.projectId, methodId, Number(versionId));
      if (!v) return NextResponse.json({ error: "Version not found" }, { status: 404 });
      // Restoring is itself recorded, so nothing is ever lost
      appendVersion(a.projectId, methodId, "restore", v.result);
      recordEvent(a.projectId, a.userId, "restore", methodId);
      return NextResponse.json({ run: saveRun(a.projectId, methodId, { status: "review", result: v.result, error: null }) });
    }
    if (action === "execute" && !run?.evidence) {
      return NextResponse.json({ error: "Run extraction first" }, { status: 400 });
    }
    if (action === "revise" && (!run?.evidence || !run?.result)) {
      return NextResponse.json({ error: "Run the analysis before revising it" }, { status: 400 });
    }

    submitJob({
      projectId: a.projectId,
      userId: a.userId,
      methodId,
      action,
      payload: { notes: typeof notes === "string" ? notes.slice(0, 5000) : "" },
    });
    return NextResponse.json({ run: getRun(a.projectId, methodId, { full: false }) }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
