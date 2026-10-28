import { retryBackgroundDatabase, backgroundErrorMessage } from "@/lib/background-retry";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client/http";
import { createDailyStatusYoutubeFetcher, getDailyStatusData } from "@/lib/daily-status-data";
import { getDailyStatusWindow, getDailyStatusToday } from "@/lib/daily-status";
import { getDailyStatusRefreshWindow, getBackfillWindow, refreshDailyStatusWindow } from "@/lib/daily-status-refresh";
import { listStoredYoutubeManagedChannels } from "@/lib/youtube-managed-channels";
import { syncYoutubeCmsAnalytics } from "@/lib/youtube-performance-sync";

const JOB_KEY = "daily-status-last-10-days";
const LEASE_MS = 20 * 60_000;

export async function runDailyStatusRefreshJob(input: { intervalHours: number; force?: boolean; signal?: AbortSignal; startDate?: string; endDate?: string }) {
  const now = new Date();
  const range = input.startDate || input.endDate ? getBackfillWindow(input.startDate ?? "", input.endDate ?? "") : getDailyStatusRefreshWindow(now);
  if (!Number.isFinite(input.intervalHours) || input.intervalHours < 1 || input.intervalHours > 24) throw new Error("Refresh interval must be between 1 and 24 hours.");
  if (!process.env.TURSO_DATABASE_URL) throw new Error("Turso database is not configured.");
  const sql = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const execute: typeof sql.execute = (statement) => retryBackgroundDatabase(() => sql.execute(statement));
  const runId = randomUUID();
  const quotaController = new AbortController();
  const signal = input.signal ? AbortSignal.any([input.signal, quotaController.signal]) : quotaController.signal;
  let acquired = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let heartbeatFailed = false;
  let leaseExpiresAt = now.getTime() + LEASE_MS;
  try {
    const lease = await execute({
      sql: `insert into youtube_daily_status_refresh_state (job_key,lease_owner,lease_until,last_started_at,last_status)
        values (?,?,?,?, 'running') on conflict(job_key) do update set lease_owner=excluded.lease_owner,
        lease_until=excluded.lease_until,last_started_at=excluded.last_started_at,last_status='running',next_run_at=excluded.last_started_at
        where (youtube_daily_status_refresh_state.lease_until is null or youtube_daily_status_refresh_state.lease_until <= ?)
        and (? = 1 or youtube_daily_status_refresh_state.next_run_at is null or youtube_daily_status_refresh_state.next_run_at <= ?)
        returning lease_owner`,
      args: [JOB_KEY, runId, new Date(now.getTime() + LEASE_MS).toISOString(), now.toISOString(), now.toISOString(), input.force ? 1 : 0, now.toISOString()]
    });
    if (!lease.rows.length) {
      const state = await execute({ sql: "select next_run_at from youtube_daily_status_refresh_state where job_key=?", args: [JOB_KEY] });
      return { status: "skipped", nextRunAt: state.rows[0]?.next_run_at ?? null };
    }
    acquired = true;
    await execute({ sql: "update youtube_daily_status_refresh_runs set status='interrupted',finished_at=? where status='running'", args: [now.toISOString()] });
    const channels = (await listStoredYoutubeManagedChannels()).sort((first, second) =>
      (first.videoCount ?? Number.MAX_SAFE_INTEGER) - (second.videoCount ?? Number.MAX_SAFE_INTEGER));
    if (!channels.length) throw new Error("No configured channels are stored.");
    await execute({ sql: `insert into youtube_daily_status_refresh_runs
      (run_id,started_at,start_date,end_date,channel_count,status) values (?,?,?,?,?,'running')`,
      args: [runId, now.toISOString(), range.startDate, range.endDate, channels.length] });
    const renew = async () => {
      const renewed = await execute({ sql: "update youtube_daily_status_refresh_state set lease_until=? where job_key=? and lease_owner=? returning lease_owner",
        args: [new Date(Date.now() + LEASE_MS).toISOString(), JOB_KEY, runId] });
      if (!renewed.rows.length) { heartbeatFailed = true; throw new Error("Refresh lease lost."); }
      leaseExpiresAt = Date.now() + LEASE_MS;
    };
    let renewalPending = false;
    heartbeat = setInterval(() => {
      if (renewalPending) return;
      renewalPending = true;
      renew().catch((error) => { console.warn(`Refresh lease renewal: ${backgroundErrorMessage(error)}`); if (Date.now() >= leaseExpiresAt - 120_000) heartbeatFailed = true; }).finally(() => { renewalPending = false; });
    }, 60_000);
    const oldestWindow = getDailyStatusWindow(range.startDate);
    const newestWindow = getDailyStatusWindow(range.endDate);
    const recentFetcher = createDailyStatusYoutubeFetcher({ ...oldestWindow, endDate: newestWindow.endDate, endDateTime: newestWindow.endDateTime }, (_stage, error) => {
      const message = backgroundErrorMessage(error);
      console.warn(`${_stage}: ${message}`);
      if (/quota|rate.?limit|too many requests|429/i.test(message)) quotaController.abort();
    }, signal);
    const result = await refreshDailyStatusWindow({
      channels, now, range, signal,
      refreshTotals: async (channel, startDate, endDate) => {
        if (heartbeatFailed) throw new Error("Refresh lease renewal failed.");
        if (input.startDate && input.endDate) {
          const saved = await execute({ sql: "select count(distinct day) as days from youtube_channel_daily_metrics where channel_id=? and day>=? and day<=? and views is not null and estimated_minutes_watched is not null and estimated_revenue is not null", args: [channel.channelId, startDate, endDate] });
          if (Number(saved.rows[0]?.days ?? 0) === range.dates.length) return;
        }
        await syncYoutubeCmsAnalytics({ channelId: channel.channelId, startDate, endDate, storePeriodBreakdowns: false, syncType: "daily" });
      },
      refreshDay: async (channel, date) => {
        if (heartbeatFailed) throw new Error("Refresh lease renewal failed.");
        const saved = await getDailyStatusData({ date, channels: [channel], canViewRevenue: true, strictStorageReads: true });
        const recent = saved.rows[0]?.recentVideos;
        const age = recent?.updatedAt ? Date.now() - Date.parse(recent.updatedAt) : Infinity;
        const historical = Date.parse(date) < Date.parse(getDailyStatusToday()) - 7 * 86_400_000;
        if (recent?.status === "available" && recent.values?.estimatedRevenue != null && (historical || age < input.intervalHours * 3_600_000)) return saved;
        return getDailyStatusData({ date, channels: [channel], canViewRevenue: true, forceRefresh: true, strictStorageReads: true, recentFetcher });
      },
      progress: async (progress) => {
        if (heartbeatFailed) throw new Error("Refresh lease renewal failed.");
        await execute({ sql: "update youtube_daily_status_refresh_runs set stored_days=?,pending_days=?,failed_days=? where run_id=?",
          args: [progress.storedDays, progress.pendingDays, progress.failedDays, runId] });
      }
    });
    const status = result.failedDays || result.pendingDays ? "partial" : "success";
    await execute({ sql: "update youtube_daily_status_refresh_runs set status=?,finished_at=? where run_id=?",
      args: [status, new Date().toISOString(), runId] });
    const nextRunAt = new Date(Date.now() + input.intervalHours * 3_600_000).toISOString();
    await execute({ sql: "update youtube_daily_status_refresh_state set lease_owner=null,lease_until=null,next_run_at=?,last_finished_at=?,last_status=? where job_key=? and lease_owner=?",
      args: [nextRunAt, new Date().toISOString(), status, JOB_KEY, runId] });
    acquired = false;
    return { status, nextRunAt, runId, channels: channels.length, ...result };
  } catch (error) {
    const failureMessage = quotaController.signal.aborted ? "YouTube quota exhausted; remaining dates will retry on the worker schedule." : backgroundErrorMessage(error);
    console.error(`Backfill stopped: ${failureMessage}`);
    if (acquired) {
      const status = input.signal?.aborted ? "interrupted" : "failed";
      await execute({ sql: "update youtube_daily_status_refresh_runs set status=?,finished_at=? where run_id=?", args: [status, new Date().toISOString(), runId] });
      await execute({ sql: "update youtube_daily_status_refresh_state set lease_owner=null,lease_until=null,next_run_at=?,last_finished_at=?,last_status=? where job_key=? and lease_owner=?",
        args: [new Date(Date.now() + (input.signal?.aborted ? 0 : input.intervalHours * 3_600_000)).toISOString(), new Date().toISOString(), status, JOB_KEY, runId] });
    }
    throw new Error(`Daily Status refresh could not complete: ${failureMessage}`, { cause: error });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    sql.close();
  }
}
