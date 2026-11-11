import { NextResponse } from "next/server";
import { updateProject, deleteProject, setProjectOrg } from "@/lib/db";
import { loadProjectForClient } from "@/lib/runs";
import { authorizeProject } from "@/lib/access";

export async function GET(_, { params }) {
  try {
    const a = await authorizeProject(params);
    if (a.error) return a.error;
    const project = loadProjectForClient(a.projectId, a.userId, a.orgId); // migrates legacy blobs, merges web sources
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ...project, role: a.role });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Members may edit a shared deal; sharing/unsharing is owner-only.
// body.shared: true → share with the caller's active organization; false → make private.
export async function PUT(request, { params }) {
  try {
    const a = await authorizeProject(params);
    if (a.error) return a.error;
    const body = await request.json();

    if ("shared" in body) {
      if (a.role !== "owner") return NextResponse.json({ error: "Only the owner can change sharing" }, { status: 403 });
      if (body.shared && !a.orgId) return NextResponse.json({ error: "Select an organization first to share this deal with your team" }, { status: 400 });
      setProjectOrg(a.projectId, a.userId, body.shared ? a.orgId : null);
    }
    const project = updateProject(a.projectId, a.userId, body, a.orgId);
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(project);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(_, { params }) {
  try {
    const a = await authorizeProject(params, { ownerOnly: true });
    if (a.error) return a.error;
    deleteProject(a.projectId, a.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
