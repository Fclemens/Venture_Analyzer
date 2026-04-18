// Simple health-check endpoint used by Docker / load-balancers.
// Intentionally public (no auth) so the container orchestrator can probe it.
export async function GET() {
  return Response.json({ ok: true, ts: Date.now() });
}
