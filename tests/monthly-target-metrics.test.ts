import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_MONTHLY_TARGET_BASELINE_SOURCE,
  aggregateTargetProgressRows,
  calculatePercentTarget,
  calculateTargetIncreasePercent,
  createEmptyActualValues,
  createEmptyTargetValues,
  getEditableMonthlyTargetMetrics,
  getEditableTargetMonths,
  getTargetBaselineCutoffMonth,
  getTargetBaselineMonth,
  getTargetBaselineMonthOptions,
  getVisibleMonthlyTargetMetrics,
  normalizeMonthlyTargetBaselineSource,
  normalizeTargetValue
} from "../lib/monthly-target-metrics.ts";

test("builds editable current and upcoming target months", () => {
  assert.deepEqual(getEditableTargetMonths(new Date("2026-06-15T08:00:00.000Z")), ["2026-06", "2026-07"]);
});

test("uses the previous completed month as the percent baseline", () => {
  const now = new Date("2026-06-15T08:00:00.000Z");

  assert.equal(getTargetBaselineMonth("2026-06", now), "2026-05");
  assert.equal(getTargetBaselineMonth("2026-07", now), "2026-05");
});

test("searches baseline data before the selected or current month", () => {
  const now = new Date("2026-06-15T08:00:00.000Z");

  assert.equal(getTargetBaselineCutoffMonth("2026-06", now), "2026-06");
  assert.equal(getTargetBaselineCutoffMonth("2026-07", now), "2026-06");
});

test("builds the last one year baseline month options", () => {
  assert.deepEqual(getTargetBaselineMonthOptions("2026-06", new Date("2026-06-15T08:00:00.000Z")), [
    "2026-05",
    "2026-04",
    "2026-03",
    "2026-02",
    "2026-01",
    "2025-12",
    "2025-11",
    "2025-10",
    "2025-09",
    "2025-08",
    "2025-07",
    "2025-06"
  ]);
});

test("normalizes monthly target baseline source selections", () => {
  const baselineMonths = ["2026-05", "2026-04", "2026-03"];

  assert.equal(normalizeMonthlyTargetBaselineSource("last-three-months-average", baselineMonths), "last-three-months-average");
  assert.equal(normalizeMonthlyTargetBaselineSource("highest-in-year", baselineMonths), "highest-in-year");
  assert.equal(normalizeMonthlyTargetBaselineSource("2026-04", baselineMonths), "2026-04");
  assert.equal(normalizeMonthlyTargetBaselineSource("2026-02", baselineMonths), DEFAULT_MONTHLY_TARGET_BASELINE_SOURCE);
});

test("calculates percent targets with metric-specific rounding", () => {
  assert.equal(calculatePercentTarget("shortViews", 1234, 10), 1357);
  assert.equal(calculatePercentTarget("shortVideosToPublish", 12, 25), 15);
  assert.equal(calculatePercentTarget("watchHours", 12.34, 15), 14.2);
  assert.equal(calculatePercentTarget("netSubscribers", 7, 50), 11);
  assert.equal(calculatePercentTarget("estimatedRevenue", 123.45, 10), 135.8);
});

test("calculates the increase from baseline to target for exports", () => {
  assert.equal(calculateTargetIncreasePercent(100, 125), 25);
  assert.equal(calculateTargetIncreasePercent(80, 72), -10);
  assert.equal(calculateTargetIncreasePercent(0, 0), 0);
  assert.equal(calculateTargetIncreasePercent(0, 10), null);
  assert.equal(calculateTargetIncreasePercent(100, null), null);
});

test("normalizes blank targets as null and rejects invalid values", () => {
  assert.equal(normalizeTargetValue("longViews", ""), null);
  assert.equal(normalizeTargetValue("watchHours", "10.24"), 10.2);
  assert.equal(normalizeTargetValue("estimatedRevenue", "10.247"), 10.25);
  assert.throws(() => normalizeTargetValue("longVideosToPublish", "-1"), /non-negative/);
});

test("only exposes revenue targets to admins", () => {
  assert.equal(getVisibleMonthlyTargetMetrics(false).some((metric) => metric.key === "estimatedRevenue"), false);
  assert.equal(getVisibleMonthlyTargetMetrics(true).some((metric) => metric.key === "estimatedRevenue"), true);
});

test("keeps publishing targets out of monthly target editing", () => {
  assert.equal(getVisibleMonthlyTargetMetrics(true).some((metric) => metric.key === "shortVideosToPublish"), true);
  assert.equal(getVisibleMonthlyTargetMetrics(true).some((metric) => metric.key === "longVideosToPublish"), true);
  assert.equal(getEditableMonthlyTargetMetrics(true).some((metric) => metric.key === "shortVideosToPublish"), false);
  assert.equal(getEditableMonthlyTargetMetrics(true).some((metric) => metric.key === "longVideosToPublish"), false);
  assert.equal(getEditableMonthlyTargetMetrics(true).some((metric) => metric.key === "estimatedRevenue"), true);
});

test("aggregates progress using only channels with targets for each metric", () => {
  const firstActual = createEmptyActualValues();
  const firstTarget = createEmptyTargetValues();
  firstActual.shortViews = 120;
  firstActual.longViews = 500;
  firstActual.shortVideosToPublish = 3;
  firstTarget.shortViews = 200;
  firstTarget.shortVideosToPublish = 5;

  const secondActual = createEmptyActualValues();
  const secondTarget = createEmptyTargetValues();
  secondActual.shortViews = 300;
  secondActual.longViews = 100;
  secondActual.shortVideosToPublish = 4;
  secondTarget.longViews = 400;
  secondTarget.shortVideosToPublish = 10;

  const aggregate = aggregateTargetProgressRows([
    { actual: firstActual, target: firstTarget },
    { actual: secondActual, target: secondTarget }
  ]);

  assert.equal(aggregate.target.shortViews, 200);
  assert.equal(aggregate.actual.shortViews, 120);
  assert.equal(aggregate.progress.shortViews.percent, 60);
  assert.equal(aggregate.target.longViews, 400);
  assert.equal(aggregate.actual.longViews, 100);
  assert.equal(aggregate.progress.longViews.remaining, 300);
  assert.equal(aggregate.target.shortVideosToPublish, 15);
  assert.equal(aggregate.actual.shortVideosToPublish, 7);
  assert.equal(aggregate.progress.shortVideosToPublish.remaining, 8);
});
