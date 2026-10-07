export const MONTHLY_GROWTH_METRICS = [
  { key: "views", label: "Public views", unit: "views" },
  { key: "engagedViews", label: "Engaged views", unit: "views" },
  { key: "watchHours", label: "Watch hours", unit: "hours" },
  { key: "netSubscribers", label: "Net subscribers", unit: "subscribers" },
  { key: "estimatedRevenue", label: "Estimated revenue", unit: "USD" }
] as const;

export type MonthlyGrowthMetric = (typeof MONTHLY_GROWTH_METRICS)[number]["key"];
export type MonthlyGrowthChannel = { channelId: string; title: string };
export type MonthlyGrowthSelection = {
  startMonth: string;
  endMonth: string;
  channelIds: string[];
  metrics: MonthlyGrowthMetric[];
};
export type MonthlyGrowthDailyRow = {
  channel_id: string;
  day: string;
  views?: number | string | null;
  engaged_views?: number | string | null;
  estimated_minutes_watched?: number | string | null;
  subscribers_gained?: number | string | null;
  subscribers_lost?: number | string | null;
  estimated_revenue?: number | string | null;
};
export type MonthlyGrowthValue = {
  value: number | null;
  change: number | null;
  percent: number | null;
  comparison: "available" | "unavailable";
};
export type MonthlyGrowthPoint = {
  month: string;
  periodEnd: string;
  monthToDate: boolean;
  coverage: "complete" | "incomplete" | "missing";
  observedDays: number;
  expectedDays: number;
  values: Partial<Record<MonthlyGrowthMetric, MonthlyGrowthValue>>;
};
export type MonthlyGrowthSeries = {
  channelId: string;
  title: string;
  points: MonthlyGrowthPoint[];
};
export type MonthlyGrowthData = MonthlyGrowthSelection & {
  generatedAt: string;
  combined: MonthlyGrowthSeries;
  channels: MonthlyGrowthSeries[];
  publicViewMethodologyWarning: boolean;
};

export function getMonthlyGrowthToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function shiftGrowthMonth(month: string, offset: number) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
}

export function growthMonthEnd(month: string) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

export function listGrowthMonths(startMonth: string, endMonth: string) {
  const months: string[] = [];
  for (let month = startMonth; month <= endMonth; month = shiftGrowthMonth(month, 1)) months.push(month);
  return months;
}

export function validateMonthlyGrowthSelection(
  selection: { startMonth: string; endMonth: string; channelIds: string[]; metrics: string[] },
  currentMonth: string,
  allowedChannelIds: string[],
  canViewRevenue: boolean
): MonthlyGrowthSelection {
  const validMonth = (month: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month >= "1900-01";
  if (!validMonth(selection.startMonth) || !validMonth(selection.endMonth) || selection.startMonth > selection.endMonth) {
    throw new Error("Select a valid start and end month. End month must be on or after start month.");
  }
  if (selection.endMonth > currentMonth) throw new Error("Future months cannot be selected.");
  if (selection.endMonth > shiftGrowthMonth(selection.startMonth, 35)) {
    throw new Error("Select a range of 36 months or less.");
  }
  const channelIds = [...new Set(selection.channelIds)];
  if (!channelIds.length || channelIds.some((id) => !allowedChannelIds.includes(id))) {
    throw new Error("Select at least one channel you have access to.");
  }
  const visibleMetrics = MONTHLY_GROWTH_METRICS.filter((metric) => canViewRevenue || metric.key !== "estimatedRevenue");
  if (!selection.metrics.length || selection.metrics.some((key) => !visibleMetrics.some((metric) => metric.key === key))) {
    throw new Error("Select at least one permitted metric.");
  }
  return {
    startMonth: selection.startMonth,
    endMonth: selection.endMonth,
    channelIds,
    metrics: visibleMetrics.filter((metric) => selection.metrics.includes(metric.key)).map((metric) => metric.key)
  };
}

// Missing daily rows are not zero. Coverage is tracked separately from observed totals.
export function buildMonthlyGrowthData({
  selection, channels, rows, today, generatedAt = new Date().toISOString(), publicViewMethodologyWarning = false
}: {
  selection: MonthlyGrowthSelection;
  channels: MonthlyGrowthChannel[];
  rows: MonthlyGrowthDailyRow[];
  today: string;
  generatedAt?: string;
  publicViewMethodologyWarning?: boolean;
}): MonthlyGrowthData {
  const comparisonStartMonth = shiftGrowthMonth(selection.startMonth, -1);
  const months = listGrowthMonths(comparisonStartMonth, selection.endMonth);
  const selectedChannels = selection.channelIds.map((id) => channels.find((channel) => channel.channelId === id)!);
  const selectedIds = new Set(selection.channelIds);
  const byChannelMonth = new Map<string, Map<string, MonthlyGrowthDailyRow>>();
  const currentMonth = today.slice(0, 7);
  let currentLastDay = "";
  for (const row of rows) {
    const month = row.day.slice(0, 7);
    if (!selectedIds.has(row.channel_id) || month < comparisonStartMonth || month > selection.endMonth || row.day > today) continue;
    if (month === currentMonth && row.day > currentLastDay) currentLastDay = row.day;
    const key = `${row.channel_id}|${month}`;
    const days = byChannelMonth.get(key) ?? new Map<string, MonthlyGrowthDailyRow>();
    days.set(row.day, row);
    byChannelMonth.set(key, days);
  }

  const makeSeries = (group: MonthlyGrowthChannel[], channelId: string, title: string): MonthlyGrowthSeries => {
    const points = months.map((month): MonthlyGrowthPoint => {
      const monthToDate = month === currentMonth;
      // Compare the current month through the latest stored day, and make gaps visible.
      const periodEnd = monthToDate ? currentLastDay || today : growthMonthEnd(month);
      const expectedDays = Number(periodEnd.slice(-2)) * group.length;
      const monthRows = group.flatMap((channel) => [...(byChannelMonth.get(`${channel.channelId}|${month}`)?.values() ?? [])]);
      const observedDays = monthRows.length;
      const coverage = observedDays === 0 ? "missing" : observedDays === expectedDays ? "complete" : "incomplete";
      const values: MonthlyGrowthPoint["values"] = {};
      for (const metric of selection.metrics) {
        const dailyValues = monthRows.map((row) => getDailyMetric(row, metric));
        const value = dailyValues.length === 0 || dailyValues.some((daily) => daily === null)
          ? null : (dailyValues as number[]).reduce((sum, daily) => sum + daily, 0);
        values[metric] = { value, change: null, percent: null, comparison: "unavailable" };
      }
      return { month, periodEnd, monthToDate, coverage, observedDays, expectedDays, values };
    });
    points.forEach((point, index) => {
      for (const metric of selection.metrics) {
        const current = point.values[metric]!;
        if (index === 0) continue;
        const previous = points[index - 1];
        const previousValue = previous.values[metric]!.value;
        if (point.coverage !== "complete" || previous.coverage !== "complete" || current.value === null || previousValue === null) continue;
        current.change = current.value - previousValue;
        current.percent = previousValue > 0 ? (current.change / previousValue) * 100 : null;
        current.comparison = "available";
      }
    });
    // The preceding month supplies the first comparison, but is not a displayed month.
    return { channelId, title, points: points.slice(1) };
  };

  return {
    ...selection,
    generatedAt,
    publicViewMethodologyWarning,
    combined: makeSeries(selectedChannels, "combined", "Combined selected channels"),
    channels: selectedChannels.map((channel) => makeSeries([channel], channel.channelId, channel.title))
  };
}

function getDailyMetric(row: MonthlyGrowthDailyRow, metric: MonthlyGrowthMetric) {
  const number = (value: unknown) => {
    if (value === null || value === undefined || value === "") return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  };
  if (metric === "netSubscribers") {
    const gained = number(row.subscribers_gained);
    const lost = number(row.subscribers_lost);
    return gained === null || lost === null ? null : gained - lost;
  }
  if (metric === "watchHours") {
    const minutes = number(row.estimated_minutes_watched);
    return minutes === null ? null : minutes / 60;
  }
  return number(row[metric === "engagedViews" ? "engaged_views" : metric === "estimatedRevenue" ? "estimated_revenue" : "views"]);
}

export function formatGrowthMonth(month: string) {
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month}-01T00:00:00Z`));
}

export function formatGrowthValue(value: number, metric: MonthlyGrowthMetric, compact = false, signed = false) {
  return new Intl.NumberFormat("en-IN", {
    ...(metric === "estimatedRevenue" ? { style: "currency", currency: "USD" } : {}),
    ...(compact ? { notation: "compact" } : {}),
    maximumFractionDigits: compact ? 1 : metric === "watchHours" || metric === "estimatedRevenue" ? 2 : 0,
    ...(signed ? { signDisplay: "exceptZero" } : {})
  }).format(value);
}

export function growthCoverageLabel(point: MonthlyGrowthPoint, channelCount = 1) {
  if (point.coverage === "missing") return "No stored data";
  const unit = channelCount > 1 ? "channel-days" : "days";
  const coverage = point.coverage === "incomplete" ? `Incomplete: ${point.observedDays}/${point.expectedDays} ${unit}` : "Complete";
  return point.monthToDate ? `Month to date through ${point.periodEnd}; ${coverage.toLowerCase()}` : coverage;
}

export function buildMonthlyGrowthExport(data: MonthlyGrowthData) {
  const rows: Array<Array<string | number>> = [];
  const headerRowNumbers: number[] = [];
  const mergedHeaders: Array<{ row: number; firstColumn: number; lastColumn: number }> = [];
  const headerRowStyles: Record<number, "section" | "month" | "columns"> = {};
  for (const series of [data.combined, ...data.channels]) {
    if (rows.length > 0) rows.push([]);
    rows.push([series.title]);
    headerRowStyles[rows.length] = "section";
    headerRowNumbers.push(rows.length);
    mergedHeaders.push({ row: rows.length, firstColumn: 1, lastColumn: 1 + series.points.length * 3 });
    const months = series.points.map((point) => `${formatGrowthMonth(point.month)}${point.monthToDate ? " (MTD)" : ""}`);
    rows.push(["Metric", ...months.flatMap((month) => [month, "", ""])]);
    headerRowStyles[rows.length] = "month";
    headerRowNumbers.push(rows.length);
    months.forEach((_, index) => mergedHeaders.push({ row: rows.length, firstColumn: 2 + index * 3, lastColumn: 4 + index * 3 }));
    rows.push(["", ...months.flatMap(() => ["Total", "Change", "Change (%)"])]);
    headerRowStyles[rows.length] = "columns";
    headerRowNumbers.push(rows.length);
    for (const metric of MONTHLY_GROWTH_METRICS.filter((item) => data.metrics.includes(item.key))) {
      rows.push([`${metric.label} (${metric.unit})`, ...series.points.flatMap((point) => {
        const value = point.values[metric.key]!;
        return [value.value ?? "Unavailable",
          value.change ?? "Unavailable",
          value.percent === null ? "N/A" : Math.round(value.percent * 100) / 100];
      })]);
    }
  }
  return { rows, headerRowNumbers, mergedHeaders, headerRowStyles };
}
