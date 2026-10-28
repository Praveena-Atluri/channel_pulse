import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { createClient } from "@libsql/client";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";

const fixture = { channels: [{ channelId: "a", title: "A" }, { channelId: "b", title: "B" }],
  totals: [] as string[], dates: [] as string[], gate: null as Promise<void> | null, failDate: "", pendingDate: "", cached: false };
const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
registerHooks({ resolve(specifier, context, nextResolve) {
  const modules: Record<string, string> = {
    "@libsql/client/http": "export const createClient = () => globalThis.__dailyStatusJobSql();",
    "@/lib/youtube-managed-channels": "export const listStoredYoutubeManagedChannels = async () => globalThis.__dailyStatusJobFixture.channels;",
    "@/lib/youtube-performance-sync": "export const syncYoutubeCmsAnalytics = async (input) => { const f=globalThis.__dailyStatusJobFixture; f.totals.push(input.channelId); if(f.gate) await f.gate; };",
    "@/lib/daily-status-data": `export const createDailyStatusYoutubeFetcher = () => async () => {};
      export const getDailyStatusData = async (input) => {
        const f=globalThis.__dailyStatusJobFixture, channel=input.channels[0];
        if(!input.forceRefresh) return f.cached ? { rows: [{ ...channel, allVideos: { status: 'available' }, recentVideos: { status: 'available', source: 'cache', updatedAt: new Date().toISOString(), revenueUpdatedAt: new Date().toISOString(), values: { views: 8, watchHours: 0.5, videoCount: 2, estimatedRevenue: 2.5 } } }] } : { rows: [] };
        if(!input.canViewRevenue) throw Error('worker must store full data');
        f.dates.push(channel.channelId+':'+input.date);
        if(channel.channelId==='a' && input.date===f.failDate) throw Error('upstream failed');
        const allVideos={status:'available',values:{views:10,watchHours:1,netSubscribers:1,estimatedRevenue:5}};
        const recentVideos={status:'available',source:'youtube',values:{views:8,watchHours:0.5,videoCount:2,estimatedRevenue:channel.channelId==='a' && input.date===f.pendingDate?null:2.5}};
        return {date:input.date,rows:[{...channel,allVideos,recentVideos}],totals:{allVideos,recentVideos}};
      };`
  };
  if (specifier in modules) return { url: stub(modules[specifier]), shortCircuit: true };
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return nextResolve(specifier, context);
} });
const { getDailyStatusRefreshWindow, getBackfillWindow, refreshDailyStatusWindow } = await import("../lib/daily-status-refresh.ts");
const { runDailyStatusRefreshJob } = await import("../lib/daily-status-refresh-job.ts");

test("refresh window is exactly ten completed IST dates, including leap-day and year boundaries", () => {
  const range = getDailyStatusRefreshWindow(new Date("2026-10-19T19:00:00Z"));
  assert.equal(range.startDate, "2026-10-10");
  assert.equal(range.endDate, "2026-10-19");
  assert.equal(range.dates.length, 10);
  assert.equal(getDailyStatusRefreshWindow(new Date("2024-03-01T01:00:00Z")).endDate, "2024-02-29");
  assert.equal(getDailyStatusRefreshWindow(new Date("2026-01-02T00:00:00Z")).startDate, "2025-12-23");
});

test("an already-aborted refresh does not call upstream dependencies", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(refreshDailyStatusWindow({ channels: fixture.channels, signal: controller.signal,
    refreshTotals: async () => assert.fail("must not sync"), refreshDay: async () => { throw new Error("must not query"); } }), /interrupted/);
});

test("background job persists progress, prevents overlap, honors scheduling, and records partial/interrupted outcomes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "daily-status-job-"));
  const url = `file:${join(directory, "jobs.db")}`;
  const sql = createClient({ url });
  const previousUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = "https://fixture.invalid";
  (globalThis as any).__dailyStatusJobSql = () => createClient({ url });
  (globalThis as any).__dailyStatusJobFixture = fixture;
  try {
    await sql.execute("create table youtube_managed_channels(channel_id text primary key)");
    const schema = await readFile(new URL("../database/turso-daily-status-cache.sql", import.meta.url), "utf8");
    await sql.executeMultiple(schema);
    await sql.execute("create table youtube_channel_daily_metrics(channel_id text,day text,views integer,estimated_minutes_watched real,estimated_revenue real)");
    await t.test("one run refreshes ten days for every channel while another worker is excluded", async () => {
      let release!: () => void;
      fixture.gate = new Promise<void>((resolve) => { release = resolve; });
      const first = runDailyStatusRefreshJob({ intervalHours: 6 });
      for (let attempt = 0; fixture.totals.length < 2 && attempt < 1000; attempt++) await setImmediate();
      assert.equal(fixture.totals.length, 2);
      const second = await runDailyStatusRefreshJob({ intervalHours: 6, force: true });
      assert.equal(second.status, "skipped");
      release(); fixture.gate = null;
      const completed = await first;
      assert.equal(completed.status, "success");
      assert.equal("storedDays" in completed && completed.storedDays, 20);
      assert.equal(new Set(fixture.dates).size, 20);
      const runs = await sql.execute("select * from youtube_daily_status_refresh_runs");
      assert.equal(runs.rows.length, 1);
      assert.equal(runs.rows[0].stored_days, 20);
      assert.equal(runs.rows[0].status, "success");
      const state = await sql.execute("select * from youtube_daily_status_refresh_state");
      assert.equal(state.rows[0].lease_owner, null);
      assert.ok(Date.parse(String(state.rows[0].next_run_at)) > Date.now() + 5 * 3_600_000);
      assert.equal((await runDailyStatusRefreshJob({ intervalHours: 6 })).status, "skipped");
      assert.equal(fixture.totals.length, 2);
    });
    await t.test("pending revenue is distinct from failed dates and progress stays queryable", async () => {
      const range = getDailyStatusRefreshWindow();
      fixture.failDate = range.startDate;
      fixture.pendingDate = range.endDate;
      const result = await runDailyStatusRefreshJob({ intervalHours: 6, force: true });
      assert.equal(result.status, "partial");
      assert.equal("storedDays" in result && result.storedDays, 19);
      assert.equal("failedDays" in result && result.failedDays, 1);
      assert.equal("pendingDays" in result && result.pendingDays, 1);
      fixture.failDate = ""; fixture.pendingDate = "";
    });
    await t.test("explicit ranges cover all channels and reuse complete saved days without YouTube calls", async () => {
      fixture.cached = true;
      const before = fixture.dates.length;
      const result = await runDailyStatusRefreshJob({ intervalHours: 6, force: true, startDate: "2026-10-01", endDate: "2026-10-24" });
      assert.equal(result.status, "success");
      assert.equal("storedDays" in result && result.storedDays, 48);
      assert.equal(fixture.dates.length, before);
      const rows = await sql.execute({ sql: "select start_date,end_date,stored_days from youtube_daily_status_refresh_runs where run_id=?", args: [result.runId] });
      assert.equal(rows.rows[0].start_date, "2026-10-01");
      assert.equal(rows.rows[0].end_date, "2026-10-24");
      fixture.cached = false;
    });
    await t.test("expired leases recover abandoned runs and graceful interruption releases the lease", async () => {
      await sql.execute("update youtube_daily_status_refresh_state set lease_owner='abandoned',lease_until='2000-01-01',next_run_at='2000-01-01'");
      await sql.execute("insert into youtube_daily_status_refresh_runs(run_id,started_at,start_date,end_date,channel_count,status) values('abandoned','2000-01-01','2000-01-01','2000-01-10',2,'running')");
      const controller = new AbortController(); controller.abort();
      await assert.rejects(runDailyStatusRefreshJob({ intervalHours: 6, signal: controller.signal }), /could not complete/);
      const abandoned = await sql.execute("select status from youtube_daily_status_refresh_runs where run_id='abandoned'");
      assert.equal(abandoned.rows[0].status, "interrupted");
      const state = await sql.execute("select lease_owner,last_status from youtube_daily_status_refresh_state");
      assert.equal(state.rows[0].lease_owner, null);
      assert.equal(state.rows[0].last_status, "interrupted");
    });
  } finally {
    fixture.gate = null;
    sql.close();
    if (previousUrl === undefined) delete process.env.TURSO_DATABASE_URL; else process.env.TURSO_DATABASE_URL = previousUrl;
    delete (globalThis as any).__dailyStatusJobSql;
    delete (globalThis as any).__dailyStatusJobFixture;
    await rm(directory, { recursive: true, force: true });
  }
});

test("historical backfill uses the requested inclusive dates and rejects invalid ranges", () => {
  const range = getBackfillWindow("2026-10-01", "2026-10-24");
  assert.equal(range.dates.length, 24);
  assert.equal(range.dates[0], "2026-10-01");
  assert.equal(range.dates[23], "2026-10-24");
  assert.throws(() => getBackfillWindow("2026-02-30", "2026-03-01"));
  assert.throws(() => getBackfillWindow("2026-10-24", "2026-10-01"));
});
