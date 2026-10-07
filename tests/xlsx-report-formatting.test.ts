import assert from "node:assert/strict";
import test from "node:test";
import { buildStyledReportWorkbook, groupAdjacentReportColumns } from "../lib/xlsx-export.ts";

function worksheet(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameSize = view.getUint16(offset + 26, true);
    const dataStart = offset + 30 + nameSize + view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.slice(offset + 30, offset + 30 + nameSize));
    if (name === "xl/worksheets/sheet1.xml") return decoder.decode(bytes.slice(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  throw new Error("Worksheet not found");
}

test("flat reports gain a merged title, colored headings, highlighted channel names, and correctly placed filters", () => {
  const rows = [["Channel", "Channel ID", "Views"], ["Channel A", "id-a", 1200]];
  const original = JSON.stringify(rows);
  const xml = worksheet(buildStyledReportWorkbook({ title: "Channel Summary", rows }));
  assert.match(xml, /<mergeCell ref="A1:C1"/);
  assert.match(xml, /r="A1"[^>]*s="4"/);
  assert.match(xml, /r="A2"[^>]*s="5"/);
  assert.match(xml, /r="A3"[^>]*s="7"/);
  assert.match(xml, /r="B3"[^>]*s="1"/);
  assert.match(xml, /r="C3"[^>]*s="1"><v>1200<\/v>/);
  assert.match(xml, /<autoFilter ref="A2:C3"/);
  assert.match(xml, /ySplit="2" topLeftCell="A3"/);
  assert.equal(JSON.stringify(rows), original);
});

test("comparison groups merge only their own columns and preserve numeric differences and percentages", () => {
  const xml = worksheet(buildStyledReportWorkbook({
    title: "Compare Summary",
    columnGroups: [{ label: "Channel", width: 1 }, { label: "Views", width: 4 }, { label: "Revenue", width: 3 }],
    rows: [["Channel", "Range 1", "Range 2", "Change", "Change (%)", "Range 1", "Range 2", "Change"],
      ["Channel A", 150, 100, 50, 50, 20, 25, -5]]
  }));
  assert.match(xml, /<mergeCell ref="B2:E2"/);
  assert.match(xml, /<mergeCell ref="F2:H2"/);
  assert.doesNotMatch(xml, /<mergeCell ref="A2:A2"/);
  assert.match(xml, /r="D4"[^>]*><v>50<\/v>/);
  assert.match(xml, /r="H4"[^>]*><v>-5<\/v>/);
  assert.match(xml, /<autoFilter ref="A3:H4"/);
  assert.match(xml, /ySplit="3" topLeftCell="A4"/);
});

test("target groups respect arbitrary selected column ordering and do not merge across other metrics", () => {
  assert.deepEqual(groupAdjacentReportColumns(["Channel", "Views", "Views", "Watch hours", "Views"]), [
    { label: "Channel", width: 1 }, { label: "Views", width: 2 }, { label: "Watch hours", width: 1 }, { label: "Views", width: 1 }
  ]);
  assert.throws(() => buildStyledReportWorkbook({
    title: "Targets", rows: [["Target", "Achievement"]], columnGroups: [{ label: "Views", width: 3 }]
  }), /match the selected columns/);
});

test("weekly reports preserve range metadata and freeze/filter the actual table headings", () => {
  const xml = worksheet(buildStyledReportWorkbook({ title: "Weekly Performance", headerRowIndex: 3,
    rows: [["Weekly Performance", "1–7 Sep"], ["Previous Week", "25–31 Aug"], [], ["Channel", "Views"], ["Channel A", 42]]
  }));
  assert.match(xml, /1–7 Sep/);
  assert.match(xml, /25–31 Aug/);
  assert.match(xml, /r="A5"[^>]*s="5"/);
  assert.match(xml, /r="A6"[^>]*s="7"/);
  assert.match(xml, /<autoFilter ref="A5:B6"/);
  assert.match(xml, /ySplit="5" topLeftCell="A6"/);
});

test("video section titles are merged while all video rows and channel names remain intact", () => {
  const xml = worksheet(buildStyledReportWorkbook({ title: "Video Report", sectionColumn: 0,
    rows: [["Section", "Channel title", "Views"], ["Top Viewed", "A", 10], ["Top Viewed", "B", 5], ["Top Revenue", "C", 20]]
  }));
  assert.match(xml, /<mergeCell ref="A3:C3"/);
  assert.match(xml, /<mergeCell ref="A6:C6"/);
  assert.match(xml, /r="B4"[^>]*s="7"/);
  assert.match(xml, /r="C4"[^>]*><v>10<\/v>/);
  assert.match(xml, /r="C5"[^>]*><v>5<\/v>/);
  assert.match(xml, /r="C7"[^>]*><v>20<\/v>/);
  assert.doesNotMatch(xml, /<autoFilter|<mergeCell ref="A4/);
});

test("a single-column report has readable headings without an invalid self-merge", () => {
  const xml = worksheet(buildStyledReportWorkbook({ title: "Channels", rows: [["Channel"], ["A"]] }));
  assert.doesNotMatch(xml, /<mergeCells/);
  assert.match(xml, /r="A3"[^>]*s="7"/);
});
