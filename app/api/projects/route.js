import { NextResponse } from "next/server";
import { listProjects, createProject } from "@/lib/db";
import { randomUUID } from "crypto";

export async function GET() {
  try {
    return NextResponse.json(listProjects());
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const project = createProject({
      id: randomUUID(),
      name: body.name || "Untitled analysis",
      entryMode: body.entryMode || "document",
    });
    return NextResponse.json(project, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
