import assert from "node:assert/strict";
import test from "node:test";

import {
  getMaximumManualRefreshEndDate,
  isManualRefreshRangeValid,
  isValidManualRefreshDate
} from "../lib/manual-data-refresh.ts";

test("validates manual refresh dates", () => {
  assert.equal(isValidManualRefreshDate("2026-06-01"), true);
  assert.equal(isValidManualRefreshDate("2026-02-30"), false);
  assert.equal(isValidManualRefreshDate("06/01/2026"), false);
});

test("limits manual refreshes to two calendar months", () => {
  assert.equal(getMaximumManualRefreshEndDate("2026-01-01"), "2026-02-28");
  assert.equal(isManualRefreshRangeValid("2026-01-01", "2026-02-28"), true);
  assert.equal(isManualRefreshRangeValid("2026-01-01", "2026-03-01"), false);
  assert.equal(isManualRefreshRangeValid("2026-01-31", "2026-03-30"), true);
  assert.equal(isManualRefreshRangeValid("2026-01-31", "2026-03-31"), false);
});

test("rejects reversed manual refresh ranges", () => {
  assert.equal(isManualRefreshRangeValid("2026-07-02", "2026-07-01"), false);
});
