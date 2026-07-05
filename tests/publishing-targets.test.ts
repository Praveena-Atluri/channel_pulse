import assert from "node:assert/strict";
import { test } from "node:test";

import {
  derivePublishingTargetForDays,
  formatPublishingTargetSourceLabel,
  normalizePublishingTargetPeriod
} from "../lib/publishing-targets.ts";

test("defaults missing publishing target cadence to daily", () => {
  assert.equal(normalizePublishingTargetPeriod(undefined), "daily");
  assert.equal(normalizePublishingTargetPeriod(null), "daily");
  assert.equal(normalizePublishingTargetPeriod(""), "daily");
});

test("only accepts daily or weekly publishing target cadence", () => {
  assert.equal(normalizePublishingTargetPeriod("daily"), "daily");
  assert.equal(normalizePublishingTargetPeriod("weekly"), "weekly");
  assert.throws(() => normalizePublishingTargetPeriod("monthly"), /daily or weekly/);
});

test("derives daily publishing targets by multiplying days", () => {
  assert.equal(derivePublishingTargetForDays({ period: "daily", value: 2 }, 31), 62);
  assert.equal(derivePublishingTargetForDays({ period: "daily", value: null }, 31), null);
});

test("derives weekly publishing targets by prorating days", () => {
  assert.equal(derivePublishingTargetForDays({ period: "weekly", value: 5 }, 31), 22);
  assert.equal(derivePublishingTargetForDays({ period: "weekly", value: 5 }, 5), 4);
  assert.equal(formatPublishingTargetSourceLabel({ period: "weekly", value: 5 }), "5/week prorated");
});
