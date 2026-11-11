// Runs once when the Next.js server starts. Starting the job worker here means
// work that was interrupted by a restart resumes without waiting for a request.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureWorker } = await import("./lib/jobs.js");
    ensureWorker();
  }
}
