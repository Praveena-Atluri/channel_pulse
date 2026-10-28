import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import { createClient, type Client } from "@libsql/client";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "@libsql/client/http") return { url: `data:text/javascript,${encodeURIComponent("export const createClient = () => globalThis.__dailyStatusStorageSql();")}`, shortCircuit: true };
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return nextResolve(specifier, context);
}, load(url, context, nextLoad) {
  if (url.endsWith("/lib/turso-admin-client.ts")) return {
    format: "module", source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), { mode: "transform" }), shortCircuit: true
  };
  return nextLoad(url, context);
} });
const { getDailyStatusData } = await import("../lib/daily-status-data.ts");

test("production data service writes through the real Turso adapter and reads persisted views, hours and revenue", async () => {
  const directory = await mkdtemp(join(tmpdir(), "daily-status-storage-"));
  const url = `file:${join(directory, "report.db")}`;
  const connections: Client[] = [];
  const open = () => { const client = createClient({ url, intMode: "number" }); connections.push(client); return client; };
  const sql = open();
  const previous = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = "https://storage-fixture.invalid";
  (globalThis as any).__dailyStatusStorageSql = open;
  try {
    await sql.execute("create table youtube_managed_channels(channel_id text primary key)");
    await sql.execute("insert into youtube_managed_channels values('a')");
    await sql.execute("create table youtube_channel_daily_metrics(channel_id text,day text,views integer,estimated_minutes_watched real,subscribers_gained integer,subscribers_lost integer,estimated_revenue real)");
    await sql.execute("insert into youtube_channel_daily_metrics values('a','2026-10-10',100,120,4,1,10)");
    await sql.executeMultiple(await readFile(new URL("../database/turso-daily-status-cache.sql", import.meta.url), "utf8"));
    const input = { date: "2026-10-10", channels: [{ channelId: "a", title: "A" }], canViewRevenue: true };
    const live = await getDailyStatusData({ ...input, forceRefresh: true, recentFetcher: async () => ({
      status: "available", values: { views: 80, watchHours: 1.5, videoCount: 5, estimatedRevenue: 3.25 }
    }) });
    assert.equal(live.rows[0].recentVideos.cacheWarning, undefined);
    const stored = await sql.execute("select views,watch_hours,estimated_revenue,video_count from youtube_daily_video_cohort_metrics");
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0].views, 80);
    assert.equal(stored.rows[0].watch_hours, 1.5);
    assert.equal(stored.rows[0].estimated_revenue, 3.25);
    assert.equal(stored.rows[0].video_count, 5);
    const saved = await getDailyStatusData({ ...input, recentFetcher: async () => { throw new Error("normal dashboard must not query YouTube"); } });
    assert.equal(saved.rows[0].recentVideos.source, "cache");
    assert.equal(saved.rows[0].recentVideos.values?.estimatedRevenue, 3.25);
    const viewer = await getDailyStatusData({ ...input, canViewRevenue: false });
    assert.doesNotMatch(JSON.stringify(viewer), /revenue/i);
  } finally {
    for (const connection of connections) connection.close();
    if (previous === undefined) delete process.env.TURSO_DATABASE_URL; else process.env.TURSO_DATABASE_URL = previous;
    delete (globalThis as any).__dailyStatusStorageSql;
    await rm(directory, { recursive: true, force: true });
  }
});
