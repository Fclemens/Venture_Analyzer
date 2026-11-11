import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { projectExists } from "@/lib/db";
import { deleteWebSource, deleteDocumentChunks, chunkStats } from "@/lib/runs";

// DELETE ?id=<sourceId>&name=<fileName>
//   id   → removes a web-discovered source row
//   name → removes all searchable chunks that came from that uploaded document
export async function DELETE(request, { params }) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!projectExists(id, userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const url = new URL(request.url);
    const sourceId = url.searchParams.get("id");
    const name = url.searchParams.get("name");
    if (sourceId) deleteWebSource(id, sourceId);
    if (name) deleteDocumentChunks(id, name);
    return NextResponse.json({ ok: true, chunks: chunkStats(id) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
