// Starts the automation scheduler once when the server process boots (post-V1 automation pass;
// see /versionTwo.md). Next calls `register()` for both the Node and Edge runtimes — the
// scheduler needs real timers and Prisma, so it only starts on the Node one.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("@onestop/api");
  startScheduler();
}
