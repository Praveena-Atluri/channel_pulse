import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import type { RangeDashboardData } from "../lib/range-dashboard.ts";
import type { DailyStatusData } from "../lib/daily-status.ts";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return nextResolve(specifier, context);
} });
const { refreshMissingRangeVideos } = await import("../lib/range-recent-refresh.ts");
const empty = { views: 100, watchHours: 4, estimatedRevenue: 5, netSubscribers: 1, engagedViews: null, engagementRate: null, recentViews: null, recentWatchHours: null, recentRevenue: null };
function fixture(): RangeDashboardData {
  return { startDate: "2026-09-26", endDate: "2026-09-27", generatedAt: "", coverage: { firstDay: null, lastDay: null },
    engagedViewsAvailable: false, publicViewMethodologyWarning: false, totals: { ...empty },
    series: [{ channel: { channelId: "a", title: "A", thumbnailUrl: null }, totals: { ...empty },
      points: ["2026-09-26", "2026-09-27"].map((day) => ({ ...empty, day })) }] };
}
function result(date: string, revenue: number | null = 2): DailyStatusData {
  return { date, rows: [{ channelId: "a", recentVideos: { status: "available", values: { views: 10, watchHours: 0.5, videoCount: 3, estimatedRevenue: revenue } } }] } as DailyStatusData;
}
test("backfills missing days and updates totals without replacing all-video metrics", async () => {
  const calls: string[] = [];
  const data = await refreshMissingRangeVideos({ data: fixture(), canViewRevenue: true, signal: new AbortController().signal,
    fetchDay: async (day, id) => { calls.push(`${id}:${day}`); return result(day); }, update: () => {} });
  assert.equal(calls.length, 2);
  assert.equal(data.totals.recentViews, 20);
  assert.equal(data.totals.recentWatchHours, 1);
  assert.equal(data.totals.recentRevenue, 4);
  assert.equal(data.totals.views, 100);
  await refreshMissingRangeVideos({ data, canViewRevenue: true, signal: new AbortController().signal,
    fetchDay: async () => { throw new Error("Complete data must not refetch"); }, update: (_data, progress) => assert.equal(progress.total, 0) });
});
test("retries missing revenue while preserving available views and reports failures", async () => {
  const data = fixture();
  data.series[0].points[0].recentViews = 10;
  let last;
  const updated = await refreshMissingRangeVideos({ data, canViewRevenue: true, signal: new AbortController().signal,
    fetchDay: async (day) => { if (day.endsWith("27")) throw new Error("upstream failure"); return result(day, null); },
    update: (_data, progress) => { last = progress; } });
  assert.equal(last.failed, 1);
  assert.equal(last.pending, 1);
  assert.equal(last.completed, 2);
  assert.equal(updated.series[0].points[0].recentViews, 10);
  assert.equal(updated.totals.recentViews, null);
});
test("restricted accounts skip revenue-only gaps and never expose fetched revenue", async () => {
  const data = fixture();
  data.series[0].points[0] = { ...data.series[0].points[0], recentViews: 10, recentWatchHours: 0.5 };
  let calls = 0;
  const updated = await refreshMissingRangeVideos({ data, canViewRevenue: false, signal: new AbortController().signal,
    fetchDay: async (day) => { calls++; return result(day); }, update: () => {} });
  assert.equal(calls, 1);
  assert.equal(updated.totals.recentViews, 20);
  assert.equal(updated.totals.recentRevenue, null);
  assert.equal(updated.series[0].points[1].recentRevenue, null);
});
test("cancellation stops new jobs and prevents stale result updates", async () => {
  const controller = new AbortController();
  let updates = 0;
  await assert.rejects(refreshMissingRangeVideos({ data: fixture(), canViewRevenue: true, signal: controller.signal,
    fetchDay: async (day) => { controller.abort(); return result(day); }, update: () => { updates++; } }), { name: "AbortError" });
  assert.equal(updates, 1);
});
