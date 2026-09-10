/**
 * Runs once when the server process starts.
 *
 * The scheduler lives in-process rather than as a second Railway service:
 * this app runs as a single long-lived Node process, so a cron here costs
 * nothing and has no extra moving parts. If you ever scale to more than one
 * instance, delete this and point Railway cron at POST /api/agenda with
 * CRON_SECRET instead — the route already supports it.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.DISABLE_SCHEDULER === "1") return;

  const cron = (await import("node-cron")).default;
  const { runAgenda } = await import("./lib/agenda");

  // Top of every hour. The rules themselves decide what's appropriate for the
  // current local hour, so the schedule stays dumb and the logic stays in one
  // place.
  cron.schedule("0 * * * *", async () => {
    try {
      const sent = await runAgenda();
      if (sent.length) {
        console.log(`[agenda] sent ${sent.length}: ${sent.map((s) => s.kind).join(", ")}`);
      }
    } catch (err) {
      console.error("[agenda] run failed:", err instanceof Error ? err.message : err);
    }
  });

  console.log("[agenda] scheduler armed — hourly");
}
