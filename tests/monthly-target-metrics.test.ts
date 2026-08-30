import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_MONTHLY_TARGET_BASELINE_SOURCE,
  aggregateTargetProgressRows,
  calculateWeightedAverageViewPercentage,
  calculateCustomMonthlyBaseline,
  calculatePercentTarget,
  calculateTargetIncreasePercent,
  createEmptyActualValues,
  createEmptyTargetValues,
  getEditableMonthlyTargetMetrics,
  getDefaultMonthlyTargetBaselineSource,
  getEditableTargetMonths,
  getCustomBaselineMaximumEndDate,
  getInclusiveDateCount,
  getTargetBaselineCutoffMonth,
  getTargetBaselineMonth,
  getTargetBaselineMonthOptions,
  getVisibleMonthlyTargetMetrics,
  normalizeMonthlyTargetBaselineSource,
  normalizeTargetValue,
  validateMonthlyTargetCustomBaselineRange
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
  assert.equal(normalizeMonthlyTargetBaselineSource("custom", baselineMonths), "custom");
  assert.equal(normalizeMonthlyTargetBaselineSource("2026-04", baselineMonths), "2026-04");
  assert.equal(normalizeMonthlyTargetBaselineSource("2026-02", baselineMonths), DEFAULT_MONTHLY_TARGET_BASELINE_SOURCE);
});

test("normalizes an inclusive custom range to the target month's day count", () => {
  assert.equal(getInclusiveDateCount("2026-06-25", "2026-08-25"), 62);
  assert.equal(calculateCustomMonthlyBaseline("shortEngagedViews", 6200, 62, "2026-09"), 3000);
  assert.equal(calculateCustomMonthlyBaseline("watchHours", 62.31, 62, "2026-09"), 30.2);
  assert.equal(calculateCustomMonthlyBaseline("longAverageViewPercentage", 45.6, 62, "2026-09"), 45.6);
  assert.equal(calculateCustomMonthlyBaseline("estimatedRevenue", 620.31, 62, "2026-09"), 300.15);
  assert.equal(calculateCustomMonthlyBaseline("shortViews", 2900, 29, "2028-02"), 2900);
});

test("counts custom ranges across month and year boundaries", () => {
  assert.equal(getInclusiveDateCount("2026-06-25", "2026-06-25"), 1);
  assert.equal(getInclusiveDateCount("2025-12-31", "2026-01-01"), 2);
  assert.equal(getInclusiveDateCount("2028-02-01", "2028-02-29"), 29);
});

test("validates custom baseline ranges against yesterday and the target month", () => {
  const now = new Date("2026-08-30T08:00:00.000Z");
  assert.equal(getCustomBaselineMaximumEndDate("2026-09", now), "2026-08-29");
  assert.equal(getCustomBaselineMaximumEndDate("2026-08", now), "2026-07-31");
  assert.equal(validateMonthlyTargetCustomBaselineRange({ startDate: "2026-06-25", endDate: "2026-08-25" }, "2026-09", now), null);
  assert.match(validateMonthlyTargetCustomBaselineRange({}, "2026-09", now) ?? "", /both custom baseline dates/);
  assert.match(validateMonthlyTargetCustomBaselineRange({ startDate: "2026-06-31", endDate: "2026-08-25" }, "2026-09", now) ?? "", /YYYY-MM-DD/);
  assert.match(validateMonthlyTargetCustomBaselineRange({ startDate: "2026-08-26", endDate: "2026-08-25" }, "2026-09", now) ?? "", /on or before/);
  assert.match(validateMonthlyTargetCustomBaselineRange({ startDate: "2026-06-25", endDate: "2026-08-30" }, "2026-09", now) ?? "", /2026-08-29/);
  assert.match(validateMonthlyTargetCustomBaselineRange({ startDate: "2026-07-01", endDate: "2026-08-01" }, "2026-08", now) ?? "", /2026-07-31/);
});

test("calculates percent targets with metric-specific rounding", () => {
  assert.equal(calculatePercentTarget("shortViews", 1234, 10), 1357);
  assert.equal(calculatePercentTarget("shortVideosToPublish", 12, 25), 15);
  assert.equal(calculatePercentTarget("watchHours", 12.34, 15), 14.2);
  assert.equal(calculatePercentTarget("longAverageViewPercentage", 40, 10), 44);
  assert.equal(calculatePercentTarget("netSubscribers", 7, 50), 11);
  assert.equal(calculatePercentTarget("estimatedRevenue", 123.45, 10), 135.8);
});

test("calculates long average percentage viewed weighted by engaged views", () => {
  assert.equal(
    calculateWeightedAverageViewPercentage([
      { averageViewPercentage: 40, engagedViews: 100 },
      { averageViewPercentage: 60, engagedViews: 300 }
    ]),
    55
  );
  assert.equal(calculateWeightedAverageViewPercentage([]), 0);
});

test("calculates the increase from baseline to target for exports", () => {
  assert.equal(calculateTargetIncreasePercent(100, 125), 25);
  assert.equal(calculateTargetIncreasePercent(80, 72), -10);
  assert.equal(calculateTargetIncreasePercent(-136, 200), 247.1);
  assert.equal(calculateTargetIncreasePercent(0, 0), 0);
  assert.equal(calculateTargetIncreasePercent(0, 10), null);
  assert.equal(calculateTargetIncreasePercent(100, null), null);
});

test("normalizes blank targets as null and rejects invalid values", () => {
  assert.equal(normalizeTargetValue("longViews", ""), null);
  assert.equal(normalizeTargetValue("watchHours", "10.24"), 10.2);
  assert.equal(normalizeTargetValue("longAverageViewPercentage", "45.56"), 45.6);
  assert.equal(normalizeTargetValue("estimatedRevenue", "10.247"), 10.25);
  assert.throws(
    () => normalizeTargetValue("longVideosToPublish", "-1"),
    /only positive numeric values are allowed\. Commas are not allowed/
  );
  assert.throws(
    () => normalizeTargetValue("shortViews", "33,400"),
    /only positive numeric values are allowed\. Commas are not allowed/
  );
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

test("uses explicit engaged-view targets from September 2026 onward", () => {
  const augustMetrics = getEditableMonthlyTargetMetrics(true, "2026-08").map((metric) => metric.key);
  const septemberMetrics = getEditableMonthlyTargetMetrics(true, "2026-09").map((metric) => metric.key);

  assert.ok(augustMetrics.includes("shortViews"));
  assert.ok(!augustMetrics.includes("shortEngagedViews"));
  assert.ok(septemberMetrics.includes("shortEngagedViews"));
  assert.ok(septemberMetrics.includes("longEngagedViews"));
  assert.ok(septemberMetrics.includes("longAverageViewPercentage"));
  assert.ok(!septemberMetrics.includes("shortViews"));
  assert.equal(getDefaultMonthlyTargetBaselineSource("2026-09"), "last-three-months-average");
});

test("aggregates progress using only channels with targets for each metric", () => {
  const firstActual = createEmptyActualValues();
  const firstTarget = createEmptyTargetValues();
  firstActual.shortViews = 120;
  firstActual.longViews = 500;
  firstActual.shortVideosToPublish = 3;
  firstTarget.shortViews = 200;
  firstTarget.shortVideosToPublish = 5;
  firstActual.longAverageViewPercentage = 40;
  firstTarget.longAverageViewPercentage = 45;

  const secondActual = createEmptyActualValues();
  const secondTarget = createEmptyTargetValues();
  secondActual.shortViews = 300;
  secondActual.longViews = 100;
  secondActual.shortVideosToPublish = 4;
  secondTarget.longViews = 400;
  secondTarget.shortVideosToPublish = 10;
  secondActual.longAverageViewPercentage = 50;
  secondTarget.longAverageViewPercentage = 55;

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
  assert.equal(aggregate.target.longAverageViewPercentage, 50);
  assert.equal(aggregate.actual.longAverageViewPercentage, 45);
});
