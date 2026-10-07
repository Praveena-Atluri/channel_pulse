import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAvailableReportMonths,
  calculateEngagementRate,
  calculateNetSubscribers,
  classifyVideoContentType,
  comparisonUsesDifferentPublicViewMethodologies,
  getCurrentReportMonth,
  getDefaultComparisonRanges,
  getMonthDateRange,
  getPreviousMonth,
  getVideoCohort,
  parseIsoDurationToSeconds,
  rangeUsesMixedPublicViewMethodology,
  safePercentChange
} from "../lib/youtube-performance-utils.ts";

test("lists every monthly report through January 2024", () => {
  const months = buildAvailableReportMonths("2026-07", new Date(Date.UTC(2026, 7, 1)));

  assert.equal(months[0], "2026-08");
  assert.equal(months.at(-1), "2024-01");
  assert.equal(months.length, 32);
  assert.ok(months.includes("2024-02"));
});

test("builds calendar month reporting ranges", () => {
  assert.deepEqual(getMonthDateRange("2026-05"), {
    startDate: "2026-05-01",
    endDate: "2026-06-01",
    analyticsEndDate: "2026-05-31"
  });
  assert.equal(getPreviousMonth("2026-01"), "2025-12");
});

test("comparison defaults put the latest completed month in Range 1 and the previous month in Range 2", () => {
  assert.deepEqual(getDefaultComparisonRanges(new Date("2026-10-07T00:00:00Z")), {
    primary: { startDate: "2026-09-01", endDate: "2026-09-30" },
    comparison: { startDate: "2026-08-01", endDate: "2026-08-31" }
  });
  assert.deepEqual(getDefaultComparisonRanges(new Date("2026-01-07T00:00:00Z")), {
    primary: { startDate: "2025-12-01", endDate: "2025-12-31" },
    comparison: { startDate: "2025-11-01", endDate: "2025-11-30" }
  });
  assert.deepEqual(getDefaultComparisonRanges(new Date("2026-09-30T19:00:00Z")), {
    primary: { startDate: "2026-09-01", endDate: "2026-09-30" },
    comparison: { startDate: "2026-08-01", endDate: "2026-08-31" }
  });
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

test("uses duration only when a video is longer than the Shorts limit", () => {
  assert.equal(parseIsoDurationToSeconds("PT2M30S"), 150);
  assert.equal(parseIsoDurationToSeconds("PT1H02M03S"), 3723);
  assert.equal(classifyVideoContentType({ durationSeconds: 150 }), "unknown");
  assert.equal(classifyVideoContentType({ durationSeconds: 180 }), "unknown");
  assert.equal(classifyVideoContentType({ durationSeconds: 181 }), "long");
  assert.equal(classifyVideoContentType({ durationSeconds: 600 }), "long");
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

test("calculates engagement rate without treating zero public views as engagement", () => {
  assert.equal(calculateEngagementRate(75, 100), 75);
  assert.equal(calculateEngagementRate(0, 0), null);
});

test("flags public-view comparisons that cross the August 24 methodology break", () => {
  assert.equal(rangeUsesMixedPublicViewMethodology("2026-08-01", "2026-08-31"), true);
  assert.equal(rangeUsesMixedPublicViewMethodology("2026-08-24", "2026-08-31"), false);
  assert.equal(
    comparisonUsesDifferentPublicViewMethodologies(
      { startDate: "2026-08-01", endDate: "2026-08-23" },
      { startDate: "2026-08-24", endDate: "2026-08-31" }
    ),
    true
  );
});
