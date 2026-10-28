import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerHooks } from "node:module";
import { createClient } from "@libsql/client";
import type { RecentVideoCacheRow } from "../lib/daily-status-cache.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return nextResolve(specifier, context);
} });
const { isRecentVideoCacheFresh, loadCachedRecentVideoStatus, validRecentVideoCache } = await import("../lib/daily-status-cache.ts");
const now = () => new Date("2026-10-20T10:00:00Z");
const row: RecentVideoCacheRow = {
  channel_id: "a", day: "2026-10-19", publication_start_date: "2026-08-19", publication_end_date: "2026-10-19",
  algorithm_version: 1, views: 123, watch_hours: 2.5, video_count: 5, fetched_at: "2026-10-20T09:30:00Z"
};
const live = { status: "available" as const, values: { views: 200, watchHours: 3.5, videoCount: 6 } };

test("fresh saved results bypass YouTube, preserving timestamp and true zeros", async () => {
  const result = await loadCachedRecentVideoStatus({ channelId: "a", date: row.day, cached: { ...row, views: 0, watch_hours: 0, video_count: 0 }, now,
    fetch: async () => { throw new Error("must not fetch"); }, save: async () => { throw new Error("must not save"); } });
  assert.deepEqual(result.values, { views: 0, watchHours: 0, videoCount: 0 });
  assert.equal(result.updatedAt, row.fetched_at);
  assert.equal(result.source, "cache");
  assert.equal(result.stale, false);
});

test("freshness uses one hour for dates within seven days and 24 hours for older dates", () => {
  assert.equal(isRecentVideoCacheFresh(row, now()), true);
  assert.equal(isRecentVideoCacheFresh({ ...row, fetched_at: "2026-10-20T09:00:00Z" }, now()), false);
  assert.equal(isRecentVideoCacheFresh({ ...row, fetched_at: "2026-10-20T10:01:00Z" }, now()), false);
  assert.equal(isRecentVideoCacheFresh({ ...row, day: "2026-10-01", fetched_at: "2026-10-19T11:00:00Z" }, now()), true);
  assert.equal(isRecentVideoCacheFresh({ ...row, day: "2026-10-01", fetched_at: "2026-10-19T10:00:00Z" }, now()), false);
});

test("cache keys and values reject different dates, channels, windows, versions and invalid metrics", () => {
  assert.equal(validRecentVideoCache(row, "a", row.day), true);
  assert.equal(validRecentVideoCache(row, "b", row.day), false);
  assert.equal(validRecentVideoCache(row, "a", "2026-10-18"), false);
  for (const patch of [{ publication_start_date: "2026-08-01" }, { publication_end_date: "2026-10-20" },
    { algorithm_version: 2 }, { views: -1 }, { views: 1.5 }, { watch_hours: NaN }, { video_count: 1.5 }, { fetched_at: "bad" }]) {
    assert.equal(validRecentVideoCache({ ...row, ...patch }, "a", row.day), false);
  }
});

test("cache misses, expiration and manual refresh save only complete live results", async () => {
  for (const cached of [undefined, { ...row, fetched_at: "2026-10-20T08:00:00Z" }]) {
    const saved: RecentVideoCacheRow[] = [];
    const result = await loadCachedRecentVideoStatus({ channelId: "a", date: row.day, cached, now,
      fetch: async () => live, save: async (value) => { saved.push(value); } });
    assert.deepEqual(result.values, live.values);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].fetched_at, now().toISOString());
    assert.equal(saved[0].publication_start_date, "2026-08-19");
    assert.equal(result.source, "youtube");
  }
  let fetched = false;
  await loadCachedRecentVideoStatus({ channelId: "a", date: row.day, cached: row, forceRefresh: true, now,
    fetch: async () => { fetched = true; return live; }, save: async () => {} });
  assert.equal(fetched, true);
});

test("failed or unavailable refreshes retain the last success and disclose stale data", async () => {
  for (const status of ["missing", "error", "incomplete"] as const) {
    const result = await loadCachedRecentVideoStatus({ channelId: "a", date: row.day, cached: { ...row, fetched_at: "2026-10-19T00:00:00Z" }, now,
      fetch: async () => ({ status, values: null }), save: async () => { throw new Error("must not overwrite last success"); } });
    assert.deepEqual(result.values, { views: 123, watchHours: 2.5, videoCount: 5 });
    assert.equal(result.stale, true);
    assert.match(result.message!, /refresh failed/);
  }
  const missing = await loadCachedRecentVideoStatus({ channelId: "a", date: row.day, now,
    fetch: async () => ({ status: "missing", values: null }), save: async () => { throw new Error("must not save"); } });
  assert.equal(missing.status, "missing");
  assert.equal(missing.values, null);
});

test("failed writes preserve live values and expose that persistence did not succeed", async () => {
  const result = await loadCachedRecentVideoStatus({ channelId: "a", date: row.day, now, fetch: async () => live,
    save: async () => { throw new Error("table missing"); } });
  assert.deepEqual(result.values, live.values);
  assert.match(result.cacheWarning!, /Could not save/);
});

test("stored-only dashboard reads never contact YouTube, including old and missing dates", async () => {
  const noFetch = async () => { throw new Error("must not contact YouTube"); };
  const old = { ...row, fetched_at: "2026-01-01T00:00:00Z" };
  const stored = await loadCachedRecentVideoStatus({ channelId: "a", date: row.day, cached: old, storedOnly: true, now, fetch: noFetch, save: async () => {} });
  assert.equal(stored.values?.views, 123);
  const missing = await loadCachedRecentVideoStatus({ channelId: "a", date: row.day, storedOnly: true, now, fetch: noFetch, save: async () => {} });
  assert.equal(missing.status, "missing");
  assert.match(missing.message!, /background job/i);
});

test("pending monetary reports retain previously stored revenue and its own timestamp", async () => {
  let saved: RecentVideoCacheRow | undefined;
  const result = await loadCachedRecentVideoStatus({ channelId: "a", date: row.day, forceRefresh: true, now,
    cached: { ...row, estimated_revenue: 8.5, revenue_fetched_at: row.fetched_at },
    fetch: async () => ({ ...live, values: { ...live.values, estimatedRevenue: null } }), save: async (value) => { saved = value; } });
  assert.equal(result.values?.estimatedRevenue, 8.5);
  assert.equal(result.values?.views, 200);
  assert.equal(result.revenueUpdatedAt, row.fetched_at);
  assert.equal(saved?.estimated_revenue, 8.5);
  assert.equal(saved?.revenue_fetched_at, row.fetched_at);
});

test("SQLite cache migration is idempotent and composite keys retain independent channel/day/window results", async () => {
  const directory = await mkdtemp(join(tmpdir(), "daily-status-cache-"));
  const url = `file:${join(directory, "cache.db")}`;
  const db = createClient({ url });
  try {
    await db.execute("create table youtube_managed_channels(channel_id text primary key)");
    await db.execute("insert into youtube_managed_channels values ('a')");
    const schema = await readFile(new URL("../database/turso-daily-status-cache.sql", import.meta.url), "utf8");
    await db.executeMultiple(schema);
    const insert = "insert into youtube_daily_recent_video_cache (channel_id,day,publication_start_date,publication_end_date,algorithm_version,views,watch_hours,video_count,fetched_at) values (?,?,?,?,?,?,?,?,?)";
    const args = ["a", row.day, row.publication_start_date, row.publication_end_date, 1, 123, 2.5, 5, row.fetched_at];
    await db.execute({ sql: insert, args });
    await db.executeMultiple(schema);
    const result = await db.execute("select * from youtube_daily_recent_video_cache");
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].views, 123);
    assert.equal(result.rows[0].watch_hours, 2.5);
    await assert.rejects(db.execute({ sql: insert, args }));
    await db.execute({ sql: insert, args: ["a", "2026-10-18", "2026-08-18", "2026-10-18", 1, 8, 1.5, 4, row.fetched_at] });
    assert.equal((await db.execute("select count(*) as count from youtube_daily_recent_video_cache")).rows[0].count, 2);
    db.close();
    const reopened = createClient({ url });
    try {
      const saved = await reopened.execute("select views,watch_hours from youtube_daily_recent_video_cache where day='2026-10-19'");
      assert.equal(saved.rows[0].views, 123);
      assert.equal(saved.rows[0].watch_hours, 2.5);
    } finally { reopened.close(); }
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});
