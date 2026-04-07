import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getAdminStats } from "@/lib/db";

export async function GET() {
  try {
    const { sessionClaims } = await auth();
    const role = sessionClaims?.metadata?.role;
    if (role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const stats = getAdminStats();

    // Enrich with Clerk user profiles (email, name) for each userId
    const client = await clerkClient();
    const enriched = await Promise.all(
      stats.users.map(async (u) => {
        try {
          const clerkUser = await client.users.getUser(u.userId);
          return {
            ...u,
            email: clerkUser.emailAddresses?.[0]?.emailAddress || u.userId,
            name: [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null,
            avatarUrl: clerkUser.imageUrl || null,
            clerkCreatedAt: clerkUser.createdAt,
          };
        } catch {
          return { ...u, email: u.userId, name: null, avatarUrl: null, clerkCreatedAt: null };
        }
      })
    );

    // Sort by last active desc
    enriched.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));

    return NextResponse.json({ ...stats, users: enriched });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
