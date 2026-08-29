import type { RangeDashboardData, RangeMetricValues } from "@/lib/range-dashboard";

export type RangeMonthlyExportRow = RangeMetricValues & {
  channelId: string;
  channelTitle: string;
  month: string;
  periodEnd: string;
  periodStart: string;
};

export function buildRangeMonthlyRows(data: RangeDashboardData): RangeMonthlyExportRow[] {
  const months = listMonths(data.startDate, data.endDate);

  return data.series.flatMap((series) => {
    const valuesByMonth = new Map<string, RangeMetricValues>();

    for (const point of series.points) {
      const month = point.day.slice(0, 7);
      const current = valuesByMonth.get(month) ?? emptyValues(data.totals.estimatedRevenue !== null);
      valuesByMonth.set(month, {
        estimatedRevenue:
          current.estimatedRevenue === null
            ? null
            : current.estimatedRevenue + (point.estimatedRevenue ?? 0),
        netSubscribers: current.netSubscribers + point.netSubscribers,
        views: current.views + point.views,
        engagedViews:
          current.engagedViews === null && point.engagedViews === null
            ? null
            : (current.engagedViews ?? 0) + (point.engagedViews ?? 0),
        engagementRate: null,
        watchHours: current.watchHours + point.watchHours
      });
    }

    return months.map((month) => {
      const monthStart = `${month}-01`;
      const monthEnd = lastDayOfMonth(month);
      const values = valuesByMonth.get(month) ?? emptyValues(data.totals.estimatedRevenue !== null);

      return {
        channelId: series.channel.channelId,
        channelTitle: series.channel.title,
        month,
        periodEnd: monthEnd < data.endDate ? monthEnd : data.endDate,
        periodStart: monthStart > data.startDate ? monthStart : data.startDate,
        ...values,
        engagementRate:
          values.engagedViews === null ? null : calculateEngagementRate(values.engagedViews, values.views)
      };
    });
  });
}

export function buildRangeMonthlyCsv(data: RangeDashboardData) {
  const includeRevenue = data.totals.estimatedRevenue !== null;
  const headers = [
    "Channel",
    "Channel ID",
    "Month",
    "Period Start",
    "Period End",
    "Public Views",
    "Engaged Views",
    "Engagement Rate (%)",
    "Watch Hours",
    "Net Subscribers",
    ...(includeRevenue ? ["Estimated Revenue (USD)"] : [])
  ];
  const rows = buildRangeMonthlyRows(data).map((row) => [
    row.channelTitle,
    row.channelId,
    row.month,
    row.periodStart,
    row.periodEnd,
    formatCsvNumber(row.views),
    row.engagedViews === null ? "Unavailable" : formatCsvNumber(row.engagedViews),
    row.engagementRate === null ? "Unavailable" : formatCsvNumber(row.engagementRate),
    formatCsvNumber(row.watchHours),
    formatCsvNumber(row.netSubscribers),
    ...(includeRevenue ? [formatCsvNumber(row.estimatedRevenue ?? 0)] : [])
  ]);

  return `\uFEFF${[headers, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
}

function listMonths(startDate: string, endDate: string) {
  const months: string[] = [];
  const cursor = new Date(`${startDate.slice(0, 7)}-01T00:00:00.000Z`);
  const lastMonth = endDate.slice(0, 7);

  while (cursor.toISOString().slice(0, 7) <= lastMonth) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months;
}

function lastDayOfMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

function emptyValues(includeRevenue: boolean): RangeMetricValues {
  return {
    estimatedRevenue: includeRevenue ? 0 : null,
    netSubscribers: 0,
    views: 0,
    engagedViews: null,
    engagementRate: null,
    watchHours: 0
  };
}

function formatCsvNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function calculateEngagementRate(engagedViews: number, publicViews: number) {
  return publicViews > 0 ? (engagedViews / publicViews) * 100 : null;
}

function escapeCsvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
