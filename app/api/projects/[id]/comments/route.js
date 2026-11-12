import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { authorizeProject } from "@/lib/access";
import { rateLimit } from "@/lib/security";
import { METHODOLOGY_REGISTRY } from "@/lib/registry";
import { addComment, listComments, deleteComment, commentCounts, setCommentResolved } from "@/lib/runs";

// Look the author's name up server-side: it is shown to teammates, so it must
// not be something the browser can set.
async function authorName(userId) {
  try {
    const u = await (await clerkClient()).users.getUser(userId);
    return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.emailAddresses?.[0]?.emailAddress?.split("@")[0] || "Team member";
  } catch {
    return "Team member";
  }
}

// GET            → every comment on the deal + counts per method
// GET ?method=id → comments on one method   (?method= (empty) → deal-level only)
export async function GET(request, { params }) {
  try {
    const a = await authorizeProject(params);
    if (a.error) return a.error;
    const url = new URL(request.url);
    const method = url.searchParams.get("method");
    const comments = listComments(a.projectId, method === null ? undefined : method === "" ? null : method);
    const { userId } = await auth();
    return NextResponse.json({ comments: comments.map(c => ({ ...c, mine: c.user_id === userId, user_id: undefined })), counts: commentCounts(a.projectId) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST { body, methodId? }
export async function POST(request, { params }) {
  try {
    const a = await authorizeProject(params);
    if (a.error) return a.error;
    const rl = rateLimit(`comments:${a.userId}`, { limit: 30 });
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry in ${rl.retryAfter}s.` }, { status: 429 });
    const { body, methodId } = await request.json();
    if (methodId && !METHODOLOGY_REGISTRY[methodId]) return NextResponse.json({ error: "Unknown methodology" }, { status: 400 });
    if (typeof body !== "string" || !body.trim()) return NextResponse.json({ error: "Comment is empty" }, { status: 400 });
    const id = addComment({ projectId: a.projectId, methodId: methodId || null, userId: a.userId, authorName: await authorName(a.userId), body });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE ?id=<commentId> — authors can delete their own comments
export async function DELETE(request, { params }) {
  try {
    const a = await authorizeProject(params);
    if (a.error) return a.error;
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!deleteComment(a.projectId, id, a.userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH { id, resolved } — any member of the deal can resolve or reopen a comment
export async function PATCH(request, { params }) {
  try {
    const a = await authorizeProject(params);
    if (a.error) return a.error;
    const { id, resolved } = await request.json();
    if (!setCommentResolved(a.projectId, Number(id), a.userId, !!resolved)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, counts: commentCounts(a.projectId) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
