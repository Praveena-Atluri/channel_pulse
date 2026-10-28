import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import type { DailyStatusData } from "../lib/daily-status.ts";
import { getDailyStatusWindow } from "../lib/daily-status.ts";
import { buildStyledReportWorkbook } from "../lib/xlsx-export.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
  return nextResolve(specifier, context);
} });
const { buildDailyStatusExport } = await import("../lib/daily-status-export.ts");

const allVideos = { status: "available" as const, values: { views: 123456, watchHours: 823.5, netSubscribers: -12, estimatedRevenue: 157.92 } };
const recentVideos = { status: "available" as const, values: { views: 54321, watchHours: 295.75, videoCount: 78, estimatedRevenue: 42.5 } };
const data: DailyStatusData = {
  date: "2026-10-19", publicationWindow: getDailyStatusWindow("2026-10-19"), generatedAt: "2026-10-20T09:00:00.000Z",
  rows: [{ channelId: "channel-a", title: "Channel A", allVideos, recentVideos },
    { channelId: "channel-b", title: "Channel B", allVideos: { status: "missing", values: null, message: "No stored analytics for this day." },
      recentVideos: { status: "error", values: null, message: "Recent-video data could not be fully loaded." } }],
  totals: { allVideos: { status: "incomplete", values: null }, recentVideos: { status: "incomplete", values: null } }
};

function worksheet(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameSize = view.getUint16(offset + 26, true);
    const dataStart = offset + 30 + nameSize + view.getUint16(offset + 28, true);
    if (decoder.decode(bytes.slice(offset + 30, offset + 30 + nameSize)) === "xl/worksheets/sheet1.xml") {
      return decoder.decode(bytes.slice(dataStart, dataStart + size));
    }
    offset = dataStart + size;
  }
  throw new Error("Worksheet not found");
}

test("default Excel report contains all permitted metrics with one row per selected channel and date context", () => {
  const report = buildDailyStatusExport(data, true);
  assert.equal(report.filename, "channel-pulse-daily-status-2026-10-19.xlsx");
  assert.deepEqual(report.rows[report.headerRowIndex], ["Channel", "Channel ID", "Total views", "Watch hours", "Net subscribers",
    "Estimated revenue (USD)", "Recent-video views", "Recent-video watch hours", "Recent-video revenue (USD)", "All-video availability", "Recent-video availability"]);
  assert.deepEqual(report.rows[report.headerRowIndex + 1], ["Channel A", "channel-a", 123456, 823.5, -12, 157.92, 54321, 295.75, 42.5, "Available", "Available"]);
  assert.equal(report.rows.length - report.headerRowIndex - 1, 2);
  assert.deepEqual(report.rows[0], ["Reporting date", "2026-10-19"]);
  assert.match(String(report.rows[1][1]), /2026-08-19 to 2026-10-19 \(inclusive\)/);
  const single = buildDailyStatusExport({ ...data, rows: [data.rows[1]] }, true);
  assert.equal(single.rows.length - single.headerRowIndex - 1, 1);
  assert.equal(single.rows[single.headerRowIndex + 1][1], "channel-b");
});

test("selected metrics alone appear, in the same canonical order as the dashboard", () => {
  const report = buildDailyStatusExport(data, true, ["recentViews", "watchHours", "watchHours"]);
  assert.deepEqual(report.rows[report.headerRowIndex], ["Channel", "Channel ID", "Watch hours", "Recent-video views", "All-video availability", "Recent-video availability"]);
  assert.deepEqual(report.rows[report.headerRowIndex + 1], ["Channel A", "channel-a", 823.5, 54321, "Available", "Available"]);
  const allOnly = buildDailyStatusExport(data, false, ["netSubscribers"]);
  assert.deepEqual(allOnly.rows[allOnly.headerRowIndex], ["Channel", "Channel ID", "Net subscribers", "All-video availability"]);
  assert.doesNotMatch(JSON.stringify(allOnly.rows), /Recent-video|published|2026-08-19/);
  const recentOnly = buildDailyStatusExport(data, false, ["recentWatchHours"]);
  assert.deepEqual(recentOnly.rows[recentOnly.headerRowIndex], ["Channel", "Channel ID", "Recent-video watch hours", "Recent-video availability"]);
  assert.throws(() => buildDailyStatusExport(data, true, []), /Select at least one metric/);
});

test("revenue is excluded without permission even when requested or present in the payload", () => {
  for (const metrics of [undefined, ["views", "estimatedRevenue"] as const]) {
    const report = buildDailyStatusExport(data, false, metrics);
    assert.doesNotMatch(JSON.stringify(report), /revenue|157\.92/i);
    assert.doesNotMatch(worksheet(buildStyledReportWorkbook(report)), /revenue|157\.92/i);
  }
  assert.throws(() => buildDailyStatusExport(data, false, ["estimatedRevenue"]), /Select at least one metric/);
});

test("unavailable metrics retain their status while true zeros and negative changes remain numeric", () => {
  const report = buildDailyStatusExport(data, true);
  assert.deepEqual(report.rows[report.headerRowIndex + 2].slice(2, 9), Array(7).fill("Unavailable"));
  assert.equal(report.rows[report.headerRowIndex + 2][9], "No stored analytics for this day.");
  const zero = buildDailyStatusExport({ ...data, rows: [{ ...data.rows[0], allVideos: { status: "available", values: { views: 0, watchHours: 0, netSubscribers: -1 } } }] }, true);
  assert.deepEqual(zero.rows[zero.headerRowIndex + 1].slice(2, 6), [0, 0, -1, "Unavailable"]);
});

test("exports disclose saved-result timestamps and failed-refresh warnings without losing the saved metrics", () => {
  const cached = { ...recentVideos, source: "cache" as const, stale: true, updatedAt: "2026-10-19T09:00:00.000Z",
    message: "YouTube refresh failed. Showing the last saved result." };
  const report = buildDailyStatusExport({ ...data, rows: [{ ...data.rows[0], recentVideos: cached }] }, false, ["recentViews"]);
  assert.equal(report.rows[report.headerRowIndex + 1][2], 54321);
  const status = String(report.rows[report.headerRowIndex + 1][3]);
  assert.match(status, /2026-10-19T09:00:00.000Z/);
  assert.match(status, /refresh failed/);
  assert.match(status, /out of date/);
});

test("saved workbook preserves numeric cell types, frozen headings, filters, safe labels and missing-data markers", () => {
  const report = buildDailyStatusExport({ ...data, rows: [{ ...data.rows[0], title: '=SUM(A1:A2) & "తెలుగు"' }, data.rows[1]] }, true);
  const xml = worksheet(buildStyledReportWorkbook(report));
  assert.match(xml, /r="C8"[^>]*><v>123456<\/v>/);
  assert.match(xml, /r="D8"[^>]*><v>823\.5<\/v>/);
  assert.match(xml, /r="E8"[^>]*><v>-12<\/v>/);
  assert.match(xml, /r="F8"[^>]*><v>157\.92<\/v>/);
  assert.match(xml, /<autoFilter ref="A7:K9"/);
  assert.match(xml, /r="I8"[^>]*><v>42\.5<\/v>/);
  assert.match(xml, /ySplit="7" topLeftCell="A8"/);
  assert.match(xml, /r="A8" t="inlineStr"/);
  assert.match(xml, /=SUM\(A1:A2\) &amp; "తెలుగు"/);
  assert.match(xml, /r="C9" t="inlineStr"[^>]*><is><t>Unavailable/);
  assert.doesNotMatch(xml, /<f>/);
});
