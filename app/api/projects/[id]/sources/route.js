import { NextResponse } from "next/server";
import { authorizeProject } from "@/lib/access";
import { deleteWebSource, deleteDocumentChunks, chunkStats } from "@/lib/runs";

// DELETE ?id=<sourceId>&name=<fileName>
//   id   → removes a web-discovered source row
//   name → removes all searchable chunks that came from that uploaded document
export async function DELETE(request, { params }) {
  try {
    const a = await authorizeProject(params);
    if (a.error) return a.error;
    const id = a.projectId;

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
