import assert from "node:assert/strict";
import test from "node:test";
import { sumRecentRangeMetrics, recentMetricCoverage } from "../lib/range-recent-metrics.ts";

test("recent range totals sum views, hours and revenue", () => {
  assert.deepEqual(sumRecentRangeMetrics([
    { recentViews: 10, recentWatchHours: 0.5, recentRevenue: 1.25 },
    { recentViews: 20, recentWatchHours: 1, recentRevenue: 2 }
  ], true), { recentViews: 30, recentWatchHours: 1.5, recentRevenue: 3.25 });
});

test("missing days or channels invalidate totals without hiding available activity for delayed revenue", () => {
  assert.deepEqual(sumRecentRangeMetrics([{ recentViews: 10, recentWatchHours: 1 }, {}], true),
    { recentViews: null, recentWatchHours: null, recentRevenue: null });
  assert.deepEqual(sumRecentRangeMetrics([{ recentViews: 0, recentWatchHours: 0, recentRevenue: null }], true),
    { recentViews: 0, recentWatchHours: 0, recentRevenue: null });
  assert.equal(sumRecentRangeMetrics([], true).recentViews, null);
});

test("revenue is removed for restricted accounts", () => {
  assert.equal(sumRecentRangeMetrics([{ recentViews: 10, recentWatchHours: 1, recentRevenue: 100 }], false).recentRevenue, null);
});

test("partial cards show available values and exact coverage independently for revenue", () => {
  const points = [{ recentViews: 100, recentRevenue: 1.5 }, { recentViews: 0, recentRevenue: null }, {}];
  assert.deepEqual(recentMetricCoverage(points, "recentViews"), { value: 100, available: 2, total: 3, complete: false });
  assert.deepEqual(recentMetricCoverage(points, "recentRevenue"), { value: 1.5, available: 1, total: 3, complete: false });
  assert.deepEqual(recentMetricCoverage([{}, {}], "recentViews"), { value: null, available: 0, total: 2, complete: false });
  assert.deepEqual(recentMetricCoverage([{ recentViews: 0 }], "recentViews"), { value: 0, available: 1, total: 1, complete: true });
  assert.equal(sumRecentRangeMetrics(points, true).recentViews, null);
});
