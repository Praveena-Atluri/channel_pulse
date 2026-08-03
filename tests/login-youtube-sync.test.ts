import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getPreviousMonthRefreshCutoff,
  getLoginSyncScope,
  isMetricUpdateBeforeCutoff,
  isLoginSyncFresh
} from "../lib/login-sync-utils.ts";

test("treats login sync state as fresh for less than one hour", () => {
  const now = new Date("2026-06-27T06:00:00.000Z");

  assert.equal(isLoginSyncFresh("2026-06-27T05:00:01.000Z", now), true);
  assert.equal(isLoginSyncFresh("2026-06-27T05:00:00.000Z", now), false);
  assert.equal(isLoginSyncFresh("2026-06-27T04:59:59.000Z", now), false);
  assert.equal(isLoginSyncFresh(null, now), false);
  assert.equal(isLoginSyncFresh("not-a-date", now), false);
});

test("builds a stable all-channel login sync scope", () => {
  assert.equal(getLoginSyncScope(["UC2", "UC1"]), getLoginSyncScope(["UC1", "UC2"]));
  assert.notEqual(getLoginSyncScope(["UC1"]), getLoginSyncScope(["UC1", "UC2"]));
});

test("uses today as the previous-month refresh cutoff during the first three days", () => {
  assert.equal(
    getPreviousMonthRefreshCutoff(new Date("2026-08-01T18:30:00.000Z")).toISOString(),
    "2026-08-01T00:00:00.000Z"
  );
  assert.equal(
    getPreviousMonthRefreshCutoff(new Date("2026-08-03T18:30:00.000Z")).toISOString(),
    "2026-08-03T00:00:00.000Z"
  );
});

test("uses the current month's fourth day as the cutoff from the fourth onward", () => {
  assert.equal(
    getPreviousMonthRefreshCutoff(new Date("2026-08-04T00:00:00.000Z")).toISOString(),
    "2026-08-04T00:00:00.000Z"
  );
  assert.equal(
    getPreviousMonthRefreshCutoff(new Date("2026-08-20T18:30:00.000Z")).toISOString(),
    "2026-08-04T00:00:00.000Z"
  );
});

test("treats previous-month metric rows updated before the fourth as stale", () => {
  const cutoff = new Date("2026-08-04T00:00:00.000Z");

  assert.equal(isMetricUpdateBeforeCutoff("2026-08-03T23:59:59.999Z", cutoff), true);
  assert.equal(isMetricUpdateBeforeCutoff("2026-08-04T00:00:00.000Z", cutoff), false);
  assert.equal(isMetricUpdateBeforeCutoff("2026-08-05T10:00:00.000Z", cutoff), false);
  assert.equal(isMetricUpdateBeforeCutoff(null, cutoff), true);
  assert.equal(isMetricUpdateBeforeCutoff("invalid", cutoff), true);
});
