import { DAILY_STATUS_METRICS, getSelectedDailyStatusMetrics, type DailyStatusData, type DailyStatusMetric,
  type DailyStatusMetrics, type DailyStatusSection, type RecentVideoMetrics } from "@/lib/daily-status";
import type { XlsxCellValue } from "@/lib/xlsx-export";

type ExportSection = DailyStatusSection<DailyStatusMetrics> | DailyStatusSection<RecentVideoMetrics>;

function metric(section: ExportSection, key: keyof DailyStatusMetrics | keyof RecentVideoMetrics): XlsxCellValue {
  const value = section.values && (section.values as Partial<DailyStatusMetrics & RecentVideoMetrics>)[key];
  return section.status === "available" && typeof value === "number" && Number.isFinite(value) ? value : "Unavailable";
}

function availability(section: ExportSection, includeRevenueTime = false) {
  return [section.message || (section.status === "available" ? "Available" : "Unavailable"),
    section.updatedAt ? `Last fetched: ${section.updatedAt}.` : "", section.stale ? "Saved result is out of date." : "",
    includeRevenueTime && section.revenueUpdatedAt ? `Revenue fetched: ${section.revenueUpdatedAt}.` : "",
    section.cacheWarning].filter(Boolean).join(" ");
}

export function buildDailyStatusExport(data: DailyStatusData, canViewRevenue: boolean,
  selectedMetrics: readonly DailyStatusMetric[] = DAILY_STATUS_METRICS.map((metric) => metric.key)) {
  const metrics = getSelectedDailyStatusMetrics(selectedMetrics, canViewRevenue);
  if (!metrics.length) throw new Error("Select at least one metric to export.");
  const hasAllVideos = metrics.some((metric) => metric.section === "allVideos");
  const hasRecentVideos = metrics.some((metric) => metric.section === "recentVideos");
  const metadata: XlsxCellValue[][] = [
    ["Reporting date", data.date],
    ...(hasRecentVideos ? [
      ["Recent videos published (IST)", `${data.publicationWindow.startDate} to ${data.publicationWindow.endDate} (inclusive)`],
      ["Recent-video performance", "Selected reporting day only"]
    ] : []),
    ["Data loaded (UTC)", data.generatedAt],
    []
  ];
  const headers = [
    "Channel", "Channel ID", ...metrics.map((metric) => metric.label),
    ...(hasAllVideos ? ["All-video availability"] : []), ...(hasRecentVideos ? ["Recent-video availability"] : [])
  ];
  const rows: XlsxCellValue[][] = [
    ...metadata, headers,
    ...data.rows.map((row) => [
      row.title, row.channelId, ...metrics.map((definition) => metric(row[definition.section], definition.valueKey)),
      ...(hasAllVideos ? [availability(row.allVideos)] : []), ...(hasRecentVideos ? [availability(row.recentVideos, canViewRevenue && metrics.some((metric) => metric.key === "recentRevenue"))] : [])
    ])
  ];
  return {
    title: `Daily Status - ${data.date}`,
    sheetName: "Daily Status",
    filename: `channel-pulse-daily-status-${data.date}.xlsx`,
    columnWidth: 24,
    headerRowIndex: metadata.length,
    rows
  };
}
