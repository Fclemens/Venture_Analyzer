import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { authorizeProject } from "@/lib/access";
import { listActivity } from "@/lib/runs";
import { METHODOLOGY_REGISTRY } from "@/lib/registry";

// GET → newest-first activity on the deal, with people's names resolved server-side
export async function GET(_request, { params }) {
  try {
    const a = await authorizeProject(params);
    if (a.error) return a.error;
    const items = listActivity(a.projectId, 30);
    const names = {};
    const client = await clerkClient().catch(() => null);
    for (const uid of [...new Set(items.map(i => i.user_id).filter(Boolean))]) {
      if (uid === a.userId) { names[uid] = "You"; continue; }
      try {
        const u = await client.users.getUser(uid);
        names[uid] = [u.firstName, u.lastName].filter(Boolean).join(" ") || "A teammate";
      } catch { names[uid] = "A teammate"; }
    }
    return NextResponse.json({
      items: items.map(({ user_id, ...i }) => ({
        ...i,
        who: i.author_name || (user_id ? names[user_id] : null),
        method: i.method_id && !i.method_id.startsWith("__") ? METHODOLOGY_REGISTRY[i.method_id]?.name || i.method_id : null,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
