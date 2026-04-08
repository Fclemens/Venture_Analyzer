import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Public routes: auth pages + Clerk webhook receiver (called server-to-server)
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks/clerk(.*)",
]);

// Admin-only routes — require role=admin in Clerk public metadata
const isAdminRoute = createRouteMatcher(["/admin(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return;

  // All non-public routes require authentication
  await auth.protect();

  // Admin routes additionally require role=admin in Clerk public metadata
  if (isAdminRoute(request)) {
    const { sessionClaims } = await auth();
    const role = (sessionClaims?.metadata as Record<string, string> | undefined)?.role;
    if (role !== "admin") {
      const url = new URL("/", request.url);
      return Response.redirect(url);
    }
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
