import { NextResponse } from "next/server";
import { authorizeProject } from "@/lib/access";
import { submitReindex } from "@/lib/jobs";
import { chunkStats } from "@/lib/runs";

// POST → re-embed this deal's chunks with the active EMBEDDING_MODEL (background job)
export async function POST(_request, { params }) {
  try {
    const a = await authorizeProject(params);
    if (a.error) return a.error;
    if (chunkStats(a.projectId).stale === 0) return NextResponse.json({ status: "up-to-date" });
    submitReindex({ projectId: a.projectId, userId: a.userId });
    return NextResponse.json({ status: "running" }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
