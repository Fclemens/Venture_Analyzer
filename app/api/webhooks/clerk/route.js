import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { logEvent } from "@/lib/db";

// Clerk sends signed webhooks — verify the signature before trusting the payload.
// Set CLERK_WEBHOOK_SECRET in env vars (Clerk dashboard → Webhooks → signing secret).
export async function POST(request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[webhook] CLERK_WEBHOOK_SECRET not set — skipping verification");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const payload = await request.text();
  const headers = {
    "svix-id":        request.headers.get("svix-id"),
    "svix-timestamp": request.headers.get("svix-timestamp"),
    "svix-signature": request.headers.get("svix-signature"),
  };

  let event;
  try {
    event = new Webhook(secret).verify(payload, headers);
  } catch (err) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const { type, data } = event;

  if (type === "session.created") {
    // data.user_id is the Clerk userId
    logEvent({ userId: data.user_id, eventType: "sign_in" });
  }

  return NextResponse.json({ ok: true });
}
