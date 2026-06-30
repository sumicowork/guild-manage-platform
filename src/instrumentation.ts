/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Used to initialize the crawl scheduler with cron jobs.
 */
export async function register() {
  // Only run on the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { initScheduler } = await import("@/services/scheduler");
      await initScheduler();
      console.log("[Instrumentation] Scheduler initialized");
    } catch (err) {
      console.error("[Instrumentation] Failed to initialize scheduler:", err);
    }
  }
}
