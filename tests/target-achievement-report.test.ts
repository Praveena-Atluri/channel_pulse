import assert from "node:assert/strict";
import test from "node:test";

import {
  getTargetAchievementColumns,
  isTargetAchievementColumnId,
  isTargetAchievementRevenueColumnId
} from "../lib/monthly-target-metrics.ts";

test("target achievement columns follow the metric era for the selected month", () => {
  const legacyIds = getTargetAchievementColumns(false, "2026-08").map((column) => column.id);
  const engagedIds = getTargetAchievementColumns(false, "2026-09").map((column) => column.id);

  assert.ok(legacyIds.includes("shortViews_target"));
  assert.ok(!legacyIds.includes("shortEngagedViews_target"));
  assert.ok(engagedIds.includes("shortEngagedViews_target"));
  assert.ok(!engagedIds.includes("shortViews_target"));
});

test("target achievement columns include only available revenue and non-publishing metrics", () => {
  const restrictedIds = getTargetAchievementColumns(false, "2026-09").map((column) => column.id);
  const revenueIds = getTargetAchievementColumns(true, "2026-09").map((column) => column.id);

  assert.ok(!restrictedIds.includes("estimatedRevenue_target"));
  assert.ok(revenueIds.includes("estimatedRevenue_target"));
  assert.ok(!revenueIds.includes("shortVideosToPublish_target"));
  assert.ok(!revenueIds.includes("longVideosToPublish_target"));
});

test("target achievement column validation recognizes supported IDs", () => {
  assert.equal(isTargetAchievementColumnId("channel"), true);
  assert.equal(isTargetAchievementColumnId("watchHours_achievement"), true);
  assert.equal(isTargetAchievementColumnId("watchHours_remaining"), false);
  assert.equal(isTargetAchievementRevenueColumnId("estimatedRevenue_percent"), true);
  assert.equal(isTargetAchievementRevenueColumnId("watchHours_percent"), false);
});
