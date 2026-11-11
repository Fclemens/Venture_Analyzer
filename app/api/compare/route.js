import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listDealSummaries } from "@/lib/runs";
import { SCORE_DIMENSIONS } from "@/lib/constants";

// GET → every deal with a generated report, plus the rubric used to score them
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({
      dimensions: SCORE_DIMENSIONS.map(({ id, label, weight }) => ({ id, label, weight })),
      deals: listDealSummaries(userId),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
