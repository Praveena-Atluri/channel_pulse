import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateNetSubscribers,
  classifyVideoContentType,
  getCurrentReportMonth,
  getMonthDateRange,
  getPreviousMonth,
  getVideoCohort,
  parseIsoDurationToSeconds,
  safePercentChange
} from "../lib/youtube-performance-utils.ts";

test("builds calendar month reporting ranges", () => {
  assert.deepEqual(getMonthDateRange("2026-05"), {
    startDate: "2026-05-01",
    endDate: "2026-06-01",
    analyticsEndDate: "2026-05-31"
  });
  assert.equal(getPreviousMonth("2026-01"), "2025-12");
});

test("builds current month reporting ranges through yesterday", () => {
  const now = new Date(Date.UTC(2026, 5, 20, 8, 30));

  assert.equal(getCurrentReportMonth(now), "2026-06");
  assert.deepEqual(getMonthDateRange("2026-06", now), {
    startDate: "2026-06-01",
    endDate: "2026-06-20",
    analyticsEndDate: "2026-06-19"
  });
});

test("classifies recent videos as selected or previous calendar month", () => {
  assert.equal(getVideoCohort("2026-05-01T00:00:00Z", "2026-05"), "recent");
  assert.equal(getVideoCohort("2026-04-12T00:00:00Z", "2026-05"), "recent");
  assert.equal(getVideoCohort("2026-03-31T23:59:59Z", "2026-05"), "old");
});

test("parses ISO 8601 durations without using duration as content type", () => {
  assert.equal(parseIsoDurationToSeconds("PT2M30S"), 150);
  assert.equal(parseIsoDurationToSeconds("PT1H02M03S"), 3723);
  assert.equal(classifyVideoContentType({ durationSeconds: 150 }), "unknown");
  assert.equal(classifyVideoContentType({ durationSeconds: 600 }), "unknown");
});

test("prefers analytics content type when available", () => {
  assert.equal(classifyVideoContentType({ analyticsContentType: "SHORTS", durationSeconds: 600 }), "short");
  assert.equal(classifyVideoContentType({ analyticsContentType: "LIVE_STREAM", durationSeconds: 30 }), "live");
});

test("calculates subscriber net growth and percent deltas", () => {
  assert.equal(calculateNetSubscribers({ subscribersGained: 120, subscribersLost: 45 }), 75);
  assert.equal(safePercentChange(150, 100), 50);
  assert.equal(safePercentChange(10, 0), 100);
  assert.equal(safePercentChange(0, 0), 0);
});
