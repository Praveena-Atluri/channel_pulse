import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getDefaultWeeklyRange,
  getMonthToMonthRanges,
  getPreviousPeriodRange,
  getTrailingWeeklyRanges
} from "../lib/weekly-performance-utils.ts";

test("builds the default weekly range through the YouTube-ready cutoff", () => {
  assert.deepEqual(getDefaultWeeklyRange(new Date("2026-06-20T08:00:00.000Z")), {
    endDate: "2026-06-18",
    startDate: "2026-06-12"
  });
});

test("builds the previous period with the same day count", () => {
  assert.deepEqual(getPreviousPeriodRange({ endDate: "2026-06-19", startDate: "2026-06-13" }), {
    endDate: "2026-06-12",
    startDate: "2026-06-06"
  });
});

test("builds the selected week and previous three weeks in chronological order", () => {
  assert.deepEqual(getTrailingWeeklyRanges({ endDate: "2026-06-19", startDate: "2026-06-13" }), [
    { endDate: "2026-05-29", startDate: "2026-05-23" },
    { endDate: "2026-06-05", startDate: "2026-05-30" },
    { endDate: "2026-06-12", startDate: "2026-06-06" },
    { endDate: "2026-06-19", startDate: "2026-06-13" }
  ]);
});

test("clamps previous month matching range to the previous month end", () => {
  assert.deepEqual(getMonthToMonthRanges("2026-03-31"), {
    current: {
      endDate: "2026-03-31",
      startDate: "2026-03-01"
    },
    previous: {
      endDate: "2026-02-28",
      startDate: "2026-02-01"
    }
  });
});
