import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMonthlyGrowthData, buildMonthlyGrowthExport, getMonthlyGrowthToday, growthMonthEnd,
  listGrowthMonths, validateMonthlyGrowthSelection,
  type MonthlyGrowthDailyRow, type MonthlyGrowthSelection
} from "../lib/monthly-growth.ts";
import { buildXlsxWorkbook } from "../lib/xlsx-export.ts";

const channels = [{ channelId: "a", title: "Channel A" }, { channelId: "b", title: "Channel B" }, { channelId: "c", title: "Channel C" }];
const selection: MonthlyGrowthSelection = {
  startMonth: "2026-04", endMonth: "2026-05", channelIds: ["a", "b"],
  metrics: ["views", "engagedViews", "watchHours", "netSubscribers", "estimatedRevenue"]
};

function dailyRows(month: string, channel: string, views: number, endDay = Number(growthMonthEnd(month).slice(-2))): MonthlyGrowthDailyRow[] {
  return Array.from({ length: endDay }, (_, index) => ({
    channel_id: channel, day: `${month}-${String(index + 1).padStart(2, "0")}`,
    views, engaged_views: views / 2, estimated_minutes_watched: 60, subscribers_gained: 5,
    subscribers_lost: 2, estimated_revenue: "1.25"
  }));
}

function makeData(rows: MonthlyGrowthDailyRow[], overrides: Partial<MonthlyGrowthSelection> = {}, today = "2026-10-07") {
  return buildMonthlyGrowthData({ selection: { ...selection, ...overrides }, channels, rows, today, generatedAt: "2026-10-07T00:00:00Z" });
}

const completeRows = [
  ...dailyRows("2026-03", "a", 80), ...dailyRows("2026-03", "b", 40),
  ...dailyRows("2026-04", "a", 100), ...dailyRows("2026-05", "a", 120),
  ...dailyRows("2026-04", "b", 50), ...dailyRows("2026-05", "b", 60)
];

test("selected channels alone contribute to combined totals, including the first month's previous-month comparison", () => {
  const data = makeData([...completeRows, ...dailyRows("2026-04", "c", 10000), ...dailyRows("2026-02", "a", 10000)]);
  assert.deepEqual(data.channels.map((channel) => channel.channelId), ["a", "b"]);
  assert.deepEqual(data.combined.points.map((point) => point.month), ["2026-04", "2026-05"]);
  assert.deepEqual(data.combined.points[0].values.views, { value: 4500, change: 780, percent: 780 / 3720 * 100, comparison: "available" });
  assert.deepEqual(data.combined.points[1].values.views, { value: 5580, change: 1080, percent: 24, comparison: "available" });
  assert.equal(data.channels[0].points[1].values.views?.value, 3720);
  assert.equal(data.channels[0].points[1].values.views?.change, 720);
  assert.equal(data.combined.points[0].values.watchHours?.value, 60);
  assert.equal(data.combined.points[0].values.netSubscribers?.value, 180);
  assert.equal(data.combined.points[0].values.estimatedRevenue?.value, 75);
});

test("each month compares with its immediately preceding month and loss stays negative", () => {
  const data = makeData([
    ...dailyRows("2026-04", "a", 100), ...dailyRows("2026-05", "a", 120), ...dailyRows("2026-06", "a", 90)
  ], { endMonth: "2026-06", channelIds: ["a"], metrics: ["views"] });
  const june = data.channels[0].points[2].values.views!;
  assert.equal(june.value, 2700);
  assert.equal(june.change, -1020);
  assert.ok(Math.abs(june.percent! - (-1020 / 3720 * 100)) < 1e-9);
});

test("first-month comparisons require prior-month data and work across a year boundary without exporting that month", () => {
  const selected = { startMonth: "2026-01", endMonth: "2026-01", channelIds: ["a"], metrics: ["views"] as const };
  const currentRows = dailyRows("2026-01", "a", 20);
  const overrides = { ...selected, metrics: [...selected.metrics] };
  const withoutPrevious = makeData(currentRows, overrides);
  assert.equal(withoutPrevious.combined.points[0].values.views?.comparison, "unavailable");
  assert.equal(withoutPrevious.combined.points[0].values.views?.value, 620);
  const incompletePrevious = makeData([...dailyRows("2025-12", "a", 10, 30), ...currentRows], overrides);
  assert.equal(incompletePrevious.combined.points[0].values.views?.change, null);
  const complete = makeData([...dailyRows("2025-12", "a", 10), ...currentRows], overrides);
  assert.deepEqual(complete.combined.points[0].values.views, { value: 620, change: 310, percent: 100, comparison: "available" });
  assert.deepEqual(complete.combined.points.map((point) => point.month), ["2026-01"]);
  assert.doesNotMatch(JSON.stringify(buildMonthlyGrowthExport(complete).rows), /Dec 2025|2025-12|Baseline/);
});

test("missing months and days stay distinct from true zeros and suppress comparisons", () => {
  const data = makeData(completeRows.filter((row) => row.channel_id !== "b" || row.day !== "2026-05-10"));
  assert.equal(data.combined.points[1].coverage, "incomplete");
  assert.equal(data.combined.points[1].observedDays, 61);
  assert.equal(data.combined.points[1].expectedDays, 62);
  assert.equal(data.combined.points[1].values.views?.change, null);
  assert.equal(data.channels[0].points[1].values.views?.change, 720);
  const missing = makeData([], { channelIds: ["a"], metrics: ["views"] });
  assert.equal(missing.combined.points[0].coverage, "missing");
  assert.equal(missing.combined.points[0].values.views?.value, null);
  const zeros = makeData([...dailyRows("2026-04", "a", 0), ...dailyRows("2026-05", "a", 0)], { channelIds: ["a"], metrics: ["views"] });
  assert.equal(zeros.combined.points[0].coverage, "complete");
  assert.equal(zeros.combined.points[0].values.views?.value, 0);
  assert.equal(zeros.combined.points[1].values.views?.change, 0);
  assert.equal(zeros.combined.points[1].values.views?.percent, null);
});

test("missing nullable metrics are unavailable without blocking other metrics", () => {
  const data = makeData(completeRows.map((row) => ({ ...row, engaged_views: row.day === "2026-05-01" ? null : row.engaged_views })));
  assert.equal(data.combined.points[1].values.engagedViews?.value, null);
  assert.equal(data.combined.points[1].values.engagedViews?.change, null);
  assert.equal(data.combined.points[1].values.views?.percent, 24);
});

test("zero and negative baselines retain numeric changes without invented percentages", () => {
  const rows = [...dailyRows("2026-04", "a", 0), ...dailyRows("2026-05", "a", 10)].map((row) => ({
    ...row, subscribers_gained: row.day.startsWith("2026-04") ? 0 : 2, subscribers_lost: 1
  }));
  const data = makeData(rows, { channelIds: ["a"], metrics: ["views", "netSubscribers"] });
  assert.equal(data.combined.points[1].values.views?.change, 310);
  assert.equal(data.combined.points[1].values.views?.percent, null);
  assert.equal(data.combined.points[0].values.netSubscribers?.value, -30);
  assert.equal(data.combined.points[1].values.netSubscribers?.change, 61);
  assert.equal(data.combined.points[1].values.netSubscribers?.percent, null);
});

test("current month uses latest stored day, flags lagging channels, and never includes future days", () => {
  const data = makeData([
    ...dailyRows("2026-09", "a", 100), ...dailyRows("2026-09", "b", 50),
    ...dailyRows("2026-10", "a", 120, 3), ...dailyRows("2026-10", "b", 60, 2),
    ...dailyRows("2026-10", "a", 120, 9).filter((row) => row.day >= "2026-10-08")
  ], { startMonth: "2026-09", endMonth: "2026-10", metrics: ["views"] });
  const october = data.combined.points[1];
  assert.equal(october.monthToDate, true);
  assert.equal(october.periodEnd, "2026-10-03");
  assert.equal(october.expectedDays, 6);
  assert.equal(october.coverage, "incomplete");
  assert.equal(october.values.views?.change, null);
  const a = data.channels[0].points[1];
  assert.equal(a.coverage, "complete");
  assert.equal(a.values.views?.value, 360);
  assert.equal(a.values.views?.change, -2640);
  assert.equal(a.values.views?.percent, -88);
});

test("one-month selections, leap years, and cross-year ranges are chronological", () => {
  assert.deepEqual(listGrowthMonths("2025-12", "2026-02"), ["2025-12", "2026-01", "2026-02"]);
  assert.equal(growthMonthEnd("2024-02"), "2024-02-29");
  const data = makeData([...dailyRows("2024-01", "a", 5), ...dailyRows("2024-02", "a", 10)], { startMonth: "2024-02", endMonth: "2024-02", channelIds: ["a"], metrics: ["views"] });
  assert.equal(data.combined.points.length, 1);
  assert.equal(data.combined.points[0].coverage, "complete");
  assert.equal(data.combined.points[0].values.views?.comparison, "available");
  assert.equal(data.combined.points[0].values.views?.change, 135);
  assert.equal(getMonthlyGrowthToday(new Date("2026-09-30T19:00:00Z")), "2026-10-01");
});

test("validation enforces channel/revenue permissions, dates, nonempty selections, and the 36-month limit", () => {
  const validate = (overrides = {}, canViewRevenue = true) => validateMonthlyGrowthSelection({ ...selection, ...overrides }, "2026-10", ["a", "b"], canViewRevenue);
  assert.throws(() => validate({ channelIds: ["c"] }), /access/);
  assert.throws(() => validate({}, false), /permitted metric/);
  assert.throws(() => validate({ metrics: ["madeUp"] }), /permitted metric/);
  assert.throws(() => validate({ metrics: [] }), /metric/);
  assert.throws(() => validate({ channelIds: [] }), /channel/);
  assert.throws(() => validate({ startMonth: "2026-13" }), /valid/);
  assert.throws(() => validate({ startMonth: "2026-06" }), /valid/);
  assert.throws(() => validate({ endMonth: "2026-11" }), /Future/);
  assert.throws(() => validate({ startMonth: "2023-10", endMonth: "2026-10" }), /36/);
  assert.equal(validate({ startMonth: "2023-11", endMonth: "2026-10" }).startMonth, "2023-11");
  assert.deepEqual(validate({ channelIds: ["a", "a"], metrics: ["watchHours", "views", "views"] }).metrics, ["views", "watchHours"]);
  assert.deepEqual(validate({ channelIds: ["a", "a"] }).channelIds, ["a"]);
});

test("only selected metrics appear in data and in horizontal Excel sections, with numeric totals and deltas", () => {
  const data = makeData(completeRows, { metrics: ["views"], channelIds: ["a"] });
  assert.deepEqual(Object.keys(data.combined.points[0].values), ["views"]);
  const report = buildMonthlyGrowthExport(data);
  assert.deepEqual(report.rows[0], ["Combined selected channels"]);
  assert.deepEqual(report.rows.find((row) => row[0] === "Channel A"), ["Channel A"]);
  assert.ok(!report.rows.flat().includes("a"));
  assert.doesNotMatch(JSON.stringify(report.rows), /Monthly Growth Report|Selected range|Selected channels|Generated at|First selected month|Percentage change is unavailable|Incomplete totals reflect|Current-month comparisons|Public views warning|Data coverage|Period end/);
  assert.deepEqual(report.mergedHeaders, [
    { row: 1, firstColumn: 1, lastColumn: 7 },
    { row: 2, firstColumn: 2, lastColumn: 4 },
    { row: 2, firstColumn: 5, lastColumn: 7 },
    { row: 6, firstColumn: 1, lastColumn: 7 },
    { row: 7, firstColumn: 2, lastColumn: 4 },
    { row: 7, firstColumn: 5, lastColumn: 7 }
  ]);
  assert.deepEqual(report.rows.find((row) => row[0] === "Metric"), ["Metric", "Apr 2026", "", "", "May 2026", "", ""]);
  assert.deepEqual(report.rows.find((row) => row[0] === "Public views (views)"), ["Public views (views)", 3000, 520, 20.97, 3720, 720, 24]);
  const serialized = JSON.stringify(report.rows);
  assert.doesNotMatch(serialized, /Estimated revenue|Watch hours|Channel B|Channel C|Mar 2026/);
  assert.match(serialized, /Channel A/);
  assert.equal(report.rows.filter((row) => row[0] === "Public views (views)").length, 2);
});

// Verify the actual stored ZIP worksheet rather than just the input row model.
function unzipStored(bytes: Uint8Array) {
  const files = new Map<string, string>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    assert.equal(view.getUint16(offset + 8, true), 0);
    const size = view.getUint32(offset + 18, true);
    const nameSize = view.getUint16(offset + 26, true);
    const extraSize = view.getUint16(offset + 28, true);
    const dataStart = offset + 30 + nameSize + extraSize;
    files.set(decoder.decode(bytes.slice(offset + 30, offset + 30 + nameSize)), decoder.decode(bytes.slice(dataStart, dataStart + size)));
    offset = dataStart + size;
  }
  return files;
}

test("real XLSX export stores numbers, header styles, safe channel text, and disables filtering for sectioned reports", () => {
  const data = makeData(completeRows, { metrics: ["views"], channelIds: ["a"] });
  data.channels[0].title = '=HYPERLINK("https://example.com") & <Channel>';
  const report = buildMonthlyGrowthExport(data);
  const files = unzipStored(buildXlsxWorkbook({ ...report, sheetName: "Monthly Growth", autoFilter: false }));
  const xml = files.get("xl/worksheets/sheet1.xml")!;
  assert.match(xml, /<v>3720<\/v>/);
  assert.match(xml, /<v>720<\/v>/);
  assert.match(xml, /<v>24<\/v>/);
  assert.match(xml, /&amp; &lt;Channel&gt;/);
  assert.doesNotMatch(xml, /<f>|<autoFilter/);
  assert.match(xml, new RegExp(`r="A${report.headerRowNumbers[1]}"[^>]*s="5"`));
  assert.match(xml, /<mergeCell ref="A1:G1"\/>/);
  assert.match(xml, /<mergeCell ref="B2:D2"\/>/);
  assert.match(xml, /<mergeCell ref="E2:G2"\/>/);
  assert.match(xml, /r="A1"[^>]*s="4"/);
  assert.match(xml, /r="G1"[^>]*s="4"/);
  assert.match(xml, /r="B2"[^>]*s="5"/);
  assert.match(xml, /r="B3"[^>]*s="6"/);
  assert.match(xml, /r="B4"[^>]*s="1"/);
  assert.match(files.get("xl/styles.xml")!, /fgColor rgb="FF17365D"/);
  assert.match(files.get("xl/styles.xml")!, /fgColor rgb="FFD9EAF7"/);
  assert.match(files.get("xl/styles.xml")!, /color rgb="FFFFFFFF"/);
  assert.match(files.get("xl/styles.xml")!, /horizontal="center" vertical="center"/);
  const legacy = unzipStored(buildXlsxWorkbook({ rows: [["Header"], [42]] })).get("xl/worksheets/sheet1.xml")!;
  assert.match(legacy, /<autoFilter/);
  assert.match(legacy, /r="A1"[^>]*s="2"/);
  assert.doesNotMatch(legacy, /<mergeCells/);
});
