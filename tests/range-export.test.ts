import assert from "node:assert/strict";
import test from "node:test";

import { buildRangeMonthlyCsv, buildRangeMonthlyRows } from "../lib/range-export.ts";
import type { RangeDashboardData } from "../lib/range-dashboard.ts";

const data: RangeDashboardData = {
  coverage: { firstDay: "2026-01-30", lastDay: "2026-03-01" },
  endDate: "2026-03-02",
  generatedAt: "2026-03-03T00:00:00.000Z",
  engagedViewsAvailable: true,
  publicViewMethodologyWarning: false,
  series: [
    {
      channel: { channelId: "channel-1", thumbnailUrl: null, title: 'Kids, "One"' },
      points: [
        { day: "2026-01-30", estimatedRevenue: 1.25, netSubscribers: 2, views: 100, engagedViews: 80, engagementRate: 80, watchHours: 3.5 },
        { day: "2026-01-31", estimatedRevenue: 2, netSubscribers: -1, views: 50, engagedViews: 40, engagementRate: 80, watchHours: 1 },
        { day: "2026-03-01", estimatedRevenue: 0.5, netSubscribers: 1, views: 25, engagedViews: 20, engagementRate: 80, watchHours: 0.25 }
      ],
      totals: { estimatedRevenue: 3.75, netSubscribers: 2, views: 175, engagedViews: 140, engagementRate: 80, watchHours: 4.75 }
    }
  ],
  startDate: "2026-01-30",
  totals: { estimatedRevenue: 3.75, netSubscribers: 2, views: 175, engagedViews: 140, engagementRate: 80, watchHours: 4.75 }
};

test("buildRangeMonthlyRows includes every selected month and clips partial-month periods", () => {
  const rows = buildRangeMonthlyRows(data);

  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(({ month, periodStart, periodEnd, views }) => ({ month, periodStart, periodEnd, views })), [
    { month: "2026-01", periodStart: "2026-01-30", periodEnd: "2026-01-31", views: 150 },
    { month: "2026-02", periodStart: "2026-02-01", periodEnd: "2026-02-28", views: 0 },
    { month: "2026-03", periodStart: "2026-03-01", periodEnd: "2026-03-02", views: 25 }
  ]);
});

test("buildRangeMonthlyCsv produces Excel-friendly escaped CSV", () => {
  const csv = buildRangeMonthlyCsv(data);

  assert.ok(csv.startsWith("\uFEFFChannel,Channel ID,Month"));
  assert.match(csv, /"Kids, ""One""",channel-1,2026-01,2026-01-30,2026-01-31,150,120,80,4\.5,1,3\.25/);
  assert.match(csv, /channel-1,2026-02,2026-02-01,2026-02-28,0,Unavailable,Unavailable,0,0,0/);
});

test("buildRangeMonthlyCsv omits revenue for accounts that cannot view it", () => {
  const restrictedData: RangeDashboardData = {
    ...data,
    series: data.series.map((series) => ({
      ...series,
      points: series.points.map((point) => ({ ...point, estimatedRevenue: null })),
      totals: { ...series.totals, estimatedRevenue: null }
    })),
    totals: { ...data.totals, estimatedRevenue: null }
  };

  const csv = buildRangeMonthlyCsv(restrictedData);

  assert.doesNotMatch(csv, /Revenue/);
  assert.match(csv, /Net Subscribers\r\n/);
});
