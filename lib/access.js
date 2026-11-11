// One place that decides who may touch a project, shared by every project route.
//   owner  → everything (share/unshare, delete)
//   member → anyone in the organization a deal is shared with: view, run
//            analyses (with their OWN API keys), comment, export
// Strangers get 404 (a project's existence is not revealed).

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { projectAccess } from "./db.js";

export async function authorizeProject(params, { ownerOnly = false } = {}) {
  const { userId, orgId } = await auth();
  if (!userId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { id } = await params;
  const role = projectAccess(id, userId, orgId ?? null);
  if (!role) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  if (ownerOnly && role !== "owner") return { error: NextResponse.json({ error: "Only the owner can do this" }, { status: 403 }) };
  return { userId, orgId: orgId ?? null, projectId: id, role };
}
