// Next.js runs this once when the server process starts. We use it to launch
// the in-process auto-sync scheduler (Node runtime only).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.ENABLE_SCHEDULER === "false") return;
  const { startScheduler } = await import("./lib/scheduler");
  startScheduler();
}
