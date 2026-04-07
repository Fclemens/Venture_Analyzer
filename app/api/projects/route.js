import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listProjects, createProject } from "@/lib/db";
import { randomUUID } from "crypto";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json(listProjects(userId));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    const project = createProject({
      id: randomUUID(),
      name: body.name || "Untitled analysis",
      entryMode: body.entryMode || "document",
      userId,
    });
    return NextResponse.json(project, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
