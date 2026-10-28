import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyStatusData, getDailyStatusToday, getDailyStatusWindow, isInDailyStatusWindow, loadRecentVideoStatus,
  shiftDailyStatusDay, validateDailyStatusSelection, type DailyStatusStoredRow } from "../lib/daily-status.ts";

const date = "2026-10-20";
const channels = [{ channelId: "a", title: "A" }, { channelId: "b", title: "B" }];
const daily: DailyStatusStoredRow[] = channels.map((channel) => ({ channel_id: channel.channelId, day: date, views: "100", estimated_minutes_watched: "90", subscribers_gained: 2, subscribers_lost: 5, estimated_revenue: "1.25" }));
const available = { status: "available" as const, values: { views: 10, watchHours: 0.5, videoCount: 2 } };

test("rolling publication window clamps month ends, crosses years, and respects leap years", () => {
  assert.equal(getDailyStatusWindow(date).startDate, "2026-08-20");
  assert.equal(getDailyStatusWindow("2026-04-30").startDate, "2026-02-28");
  assert.equal(getDailyStatusWindow("2024-04-30").startDate, "2024-02-29");
  assert.equal(getDailyStatusWindow("2026-01-31").startDate, "2025-11-30");
  assert.equal(getDailyStatusToday(new Date("2026-10-19T19:00:00Z")), date);
  assert.equal(shiftDailyStatusDay("2024-03-01", -1), "2024-02-29");
});

test("publication bounds include both IST dates and exclude adjacent instants", () => {
  const window = getDailyStatusWindow(date);
  assert.equal(window.startDateTime, "2026-08-19T18:30:00.000Z");
  assert.equal(window.endDateTime, "2026-10-20T18:30:00.000Z");
  for (const timestamp of [window.startDateTime, "2026-10-20T18:29:59.999Z"]) assert.equal(isInDailyStatusWindow(timestamp, window), true);
  for (const timestamp of ["2026-08-19T18:29:59.999Z", window.endDateTime, null, "invalid"]) assert.equal(isInDailyStatusWindow(timestamp, window), false);
});

test("selection rejects invalid, future, empty and unauthorized selections", () => {
  assert.doesNotThrow(() => validateDailyStatusSelection(date, ["a"], ["a"], date));
  for (const value of ["2026-02-30", "2026-13-01", "2026-10-21", "", "bad", "2004-01-01"]) assert.throws(() => validateDailyStatusSelection(value, ["a"], ["a"], date));
  assert.throws(() => validateDailyStatusSelection(date, [], ["a"], date));
  assert.throws(() => validateDailyStatusSelection(date, ["b"], ["a"], date));
});

test("aggregates only selected-day channel metrics, hours and negative subscribers", async () => {
  const data = await buildDailyStatusData({ date, channels, canViewRevenue: true, dailyRows: async () => [
    { ...daily[0], day: "2026-10-01", views: 999999 }, ...daily, { ...daily[0], channel_id: "forbidden", views: 999999 }
  ], recent: async () => available });
  assert.deepEqual(data.totals.allVideos.values, { views: 200, watchHours: 3, netSubscribers: -6, estimatedRevenue: 2.5 });
  assert.deepEqual(data.totals.recentVideos.values, { views: 20, watchHours: 1, videoCount: 4 });
});

test("revenue is absent from all response values when access is disabled", async () => {
  const data = await buildDailyStatusData({ date, channels, canViewRevenue: false, dailyRows: async () => daily, recent: async () => available });
  assert.doesNotMatch(JSON.stringify(data), /estimatedRevenue|estimated_revenue/);
});

test("missing and failed sections preserve independent results and suppress combined partial sums", async () => {
  const data = await buildDailyStatusData({ date, channels, canViewRevenue: true, dailyRows: async () => [daily[0]], recent: async (channel) => {
    if (channel.channelId === "b") throw new Error("quota");
    return available;
  } });
  assert.equal(data.rows[0].allVideos.values?.views, 100);
  assert.equal(data.rows[1].allVideos.status, "missing");
  assert.equal(data.rows[1].recentVideos.status, "error");
  assert.equal(data.totals.allVideos.values, null);
  assert.equal(data.totals.recentVideos.values, null);
  const dbFailure = await buildDailyStatusData({ date, channels, canViewRevenue: false, dailyRows: async () => { throw new Error("db"); }, recent: async () => available });
  assert.equal(dbFailure.totals.allVideos.values, null);
  assert.equal(dbFailure.totals.recentVideos.values?.views, 20);
});

test("known empty cohorts are zero without requiring an analytics request", async () => {
  const result = await loadRecentVideoStatus({ date, channelId: "a", catalog: async () => [], report: async () => { throw new Error("must not query"); } });
  assert.deepEqual(result, { status: "available", values: { views: 0, watchHours: 0, videoCount: 0 } });
});

test("recent cohorts filter exact dates and channel, deduplicate IDs, and batch all videos", async () => {
  const videos = Array.from({ length: 205 }, (_, index) => ({ channelId: "a", videoId: `v${index}`, publishedAt: "2026-09-01T00:00:00Z" }));
  const calls: Array<string[] | undefined> = [];
  const result = await loadRecentVideoStatus({ date, channelId: "a", catalog: async () => [
    ...videos, videos[0], { ...videos[0], videoId: "old", publishedAt: "2026-08-19T18:29:59Z" },
    { ...videos[0], videoId: "future", publishedAt: "2026-10-20T18:30:00Z" }, { ...videos[0], channelId: "b", videoId: "other" }
  ], report: async (ids) => { calls.push(ids); return [{ day: date, views: ids?.length ?? 9999, estimatedMinutesWatched: (ids?.length ?? 9999) * 60 }]; } });
  assert.deepEqual(calls.map((ids) => ids?.length), [undefined, 100, 100, 5]);
  assert.deepEqual(result.values, { views: 205, watchHours: 205, videoCount: 205 });
});

test("missing reporting day and failed batches never produce misleading zeros or partial totals", async () => {
  const catalog = async () => Array.from({ length: 101 }, (_, index) => ({ channelId: "a", videoId: `v${index}`, publishedAt: "2026-09-01T00:00:00Z" }));
  const missing = await loadRecentVideoStatus({ date, channelId: "a", catalog, report: async () => [] });
  assert.equal(missing.status, "missing");
  assert.equal(missing.values, null);
  const failed = await loadRecentVideoStatus({ date, channelId: "a", catalog, report: async (ids) => {
    if (ids?.length === 1) throw new Error("failed second batch");
    return [{ day: date, views: 100, estimatedMinutesWatched: 60 }];
  } });
  assert.equal(failed.status, "error");
  assert.equal(failed.values, null);
  const wrongDay = await loadRecentVideoStatus({ date, channelId: "a", catalog, report: async (ids) => [{ day: ids ? "2026-10-01" : date, views: 100000, estimatedMinutesWatched: 60000 }] });
  assert.equal(wrongDay.values, null);
  const zero = await loadRecentVideoStatus({ date, channelId: "a", catalog, report: async (ids) => ids ? [] : [{ day: date, views: 1, estimatedMinutesWatched: 1 }] });
  assert.deepEqual(zero.values, { views: 0, watchHours: 0, videoCount: 101 });
});

test("recent-video revenue uses the same publication cohort and selected day without delaying views on monetary failure", async () => {
  const catalog = async () => [{ channelId: "a", videoId: "recent", publishedAt: "2026-09-01T00:00:00Z" },
    { channelId: "a", videoId: "old", publishedAt: "2026-07-01T00:00:00Z" }];
  const revenueIds: Array<string[] | undefined> = [];
  const input = { date, channelId: "a", catalog, report: async () => [{ day: date, views: 10, estimatedMinutesWatched: 60 }] };
  const result = await loadRecentVideoStatus({ ...input, revenueReport: async (ids) => {
    revenueIds.push(ids); return [{ day: date, estimatedRevenue: ids ? 1.75 : 500 }];
  } });
  assert.deepEqual(revenueIds, [undefined, ["recent"]]);
  assert.deepEqual(result.values, { views: 10, watchHours: 1, videoCount: 1, estimatedRevenue: 1.75 });
  const unavailable = await loadRecentVideoStatus({ ...input, revenueReport: async () => [] });
  assert.equal(unavailable.values?.estimatedRevenue, null);
  assert.equal(unavailable.values?.views, 10);
  const denied = await loadRecentVideoStatus({ ...input, revenueReport: async () => { throw new Error("monetary scope denied"); } });
  assert.equal(denied.values?.estimatedRevenue, null);
  assert.equal(denied.values?.watchHours, 1);
});

test("combined recent revenue is unavailable if any channel is pending and viewer results omit both revenue values and metadata", async () => {
  const recent = async (channel: { channelId: string }) => ({ ...available,
    values: { ...available.values, estimatedRevenue: channel.channelId === "a" ? 20 : null }, revenueUpdatedAt: "2026-10-20T00:00:00Z" });
  const admin = await buildDailyStatusData({ date, channels, canViewRevenue: true, dailyRows: async () => daily, recent });
  assert.equal(admin.totals.recentVideos.values?.estimatedRevenue, null);
  assert.equal(admin.totals.recentVideos.values?.views, 20);
  const viewer = await buildDailyStatusData({ date, channels, canViewRevenue: false, dailyRows: async () => daily, recent });
  assert.doesNotMatch(JSON.stringify(viewer), /revenue/i);
});
