import { Agent, EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
// Slow local DNS must not exhaust Node's default ten-second connect timeout.
const connectionOptions = { connect: { timeout: 60_000 } };
setGlobalDispatcher(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy
  ? new EnvHttpProxyAgent(connectionOptions) : new Agent(connectionOptions));
import { registerHooks } from "node:module";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}.ts`, root).href, context);
  return nextResolve(specifier, context);
} });
const { runDailyStatusRefreshJob } = await import("../lib/daily-status-refresh-job.ts");
const once = process.argv.includes("--once");
const startDate = process.argv.find((arg) => arg.startsWith("--start="))?.slice(8);
const endDate = process.argv.find((arg) => arg.startsWith("--end="))?.slice(6);
const { getBackfillWindow } = await import("../lib/daily-status-refresh.ts");
const customRange = startDate || endDate ? getBackfillWindow(startDate ?? "", endDate ?? "") : undefined;
const intervalHours = Number(process.env.DAILY_STATUS_REFRESH_INTERVAL_HOURS ?? 6);
if (!Number.isFinite(intervalHours) || intervalHours < 1 || intervalHours > 24) throw new Error("DAILY_STATUS_REFRESH_INTERVAL_HOURS must be between 1 and 24.");
if (process.argv.includes("--dry-run")) {
  const { getDailyStatusRefreshWindow } = await import("../lib/daily-status-refresh.ts");
  console.log(JSON.stringify({ mode: "dry-run", intervalHours, ...(customRange ?? getDailyStatusRefreshWindow()) }));
  process.exit(0);
}
const controller = new AbortController();
let wake;
const stop = () => { controller.abort(); wake?.(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const workerDirectory = fileURLToPath(new URL("../.daily-status-worker/", import.meta.url));
await mkdir(workerDirectory, { recursive: true });
const pidPath = join(workerDirectory, "worker.pid");
if (!once) {
  try {
    const pidFile = await open(pidPath, "wx");
    await pidFile.writeFile(String(process.pid));
    await pidFile.close();
  } catch {
    const existingPid = Number(await readFile(pidPath, "utf8").catch(() => ""));
    let existingIsRunning = false;
    if (Number.isInteger(existingPid) && existingPid > 0) {
      try { process.kill(existingPid, 0); existingIsRunning = true; } catch (error) { if (error.code !== "ESRCH") existingIsRunning = true; }
    }
    if (existingIsRunning) {
      console.error("A background worker is already running.");
      process.exit(1);
    }
    await unlink(pidPath);
    const pidFile = await open(pidPath, "wx");
    await pidFile.writeFile(String(process.pid));
    await pidFile.close();
  }
}
try {
  do {
    let waitMs = intervalHours * 3_600_000;
    try {
      let result = await runDailyStatusRefreshJob({ intervalHours, force: once, signal: controller.signal, startDate, endDate });
      console.log(JSON.stringify({ time: new Date().toISOString(), ...result }));
      if (!once && customRange && (result.status === "success" || result.status === "partial")) {
        result = await runDailyStatusRefreshJob({ intervalHours, force: true, signal: controller.signal });
        console.log(JSON.stringify({ time: new Date().toISOString(), mode: "rolling-refresh", ...result }));
      }
      const next = typeof result.nextRunAt === "string" ? Date.parse(result.nextRunAt) - Date.now() : 60_000;
      waitMs = result.status === "skipped" ? Math.max(60_000, Math.min(next, 5 * 60_000)) : Math.max(60_000, next);
      if (once && result.status !== "success" && result.status !== "skipped") process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Daily Status background refresh failed.");
      if (once) process.exitCode = 1;
    }
    if (once || controller.signal.aborted) break;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, waitMs);
      wake = () => { clearTimeout(timer); resolve(); };
      if (controller.signal.aborted) wake();
    });
    wake = undefined;
  } while (!controller.signal.aborted);
} finally {
  if (!once) await unlink(pidPath).catch(() => {});
}
