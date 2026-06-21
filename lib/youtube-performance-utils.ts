export type VideoContentType = "short" | "long" | "live" | "unknown";
export type VideoCohort = "all" | "recent" | "old";

export type MetricTotals = {
  views: number;
  estimatedMinutesWatched: number;
  subscribersGained: number;
  subscribersLost: number;
  estimatedRevenue: number;
  estimatedAdRevenue: number;
  grossRevenue: number;
  monetizedPlaybacks: number;
  adImpressions: number;
  playbackBasedCpm: number;
};

export const EMPTY_TOTALS: MetricTotals = {
  views: 0,
  estimatedMinutesWatched: 0,
  subscribersGained: 0,
  subscribersLost: 0,
  estimatedRevenue: 0,
  estimatedAdRevenue: 0,
  grossRevenue: 0,
  monetizedPlaybacks: 0,
  adImpressions: 0,
  playbackBasedCpm: 0
};

export function createEmptyTotals(): MetricTotals {
  return { ...EMPTY_TOTALS };
}

export function addMetricTotals(left: MetricTotals, right: Partial<MetricTotals>) {
  left.views += right.views ?? 0;
  left.estimatedMinutesWatched += right.estimatedMinutesWatched ?? 0;
  left.subscribersGained += right.subscribersGained ?? 0;
  left.subscribersLost += right.subscribersLost ?? 0;
  left.estimatedRevenue += right.estimatedRevenue ?? 0;
  left.estimatedAdRevenue += right.estimatedAdRevenue ?? 0;
  left.grossRevenue += right.grossRevenue ?? 0;
  left.monetizedPlaybacks += right.monetizedPlaybacks ?? 0;
  left.adImpressions += right.adImpressions ?? 0;
  left.playbackBasedCpm += right.playbackBasedCpm ?? 0;
}

export function calculateNetSubscribers(input: Pick<MetricTotals, "subscribersGained" | "subscribersLost">) {
  return input.subscribersGained - input.subscribersLost;
}

export function safePercentChange(current: number, previous: number) {
  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }

  return ((current - previous) / Math.abs(previous)) * 100;
}

export function getDefaultReportMonth(now = new Date()) {
  const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return formatMonth(previousMonth);
}

export function getCurrentReportMonth(now = new Date()) {
  return formatMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
}

export function formatMonth(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function getMonthDateRange(month: string, now = new Date()) {
  const [year, monthNumber] = parseMonth(month);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const calendarEnd = new Date(Date.UTC(year, monthNumber, 1));
  const currentMonth = getCurrentReportMonth(now);
  const selectedMonth = formatMonth(start);
  const end =
    selectedMonth === currentMonth
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      : calendarEnd;
  const analyticsEnd = new Date(end.getTime() - 86_400_000);

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
    analyticsEndDate: formatDate(analyticsEnd.getTime() < start.getTime() ? start : analyticsEnd)
  };
}

export function getPreviousMonth(month: string) {
  const [year, monthNumber] = parseMonth(month);
  return formatMonth(new Date(Date.UTC(year, monthNumber - 2, 1)));
}

export function getRecentVideoWindow(month: string) {
  const previousMonth = getPreviousMonth(month);
  return {
    startDate: getMonthDateRange(previousMonth).startDate,
    endDate: getMonthDateRange(month).endDate
  };
}

export function getVideoCohort(publishedAt: string | null, selectedMonth: string): Exclude<VideoCohort, "all"> {
  if (!publishedAt) {
    return "old";
  }

  const publishedTime = new Date(publishedAt).getTime();
  if (Number.isNaN(publishedTime)) {
    return "old";
  }

  const recentWindow = getRecentVideoWindow(selectedMonth);
  const recentStart = new Date(`${recentWindow.startDate}T00:00:00.000Z`).getTime();
  const recentEnd = new Date(`${recentWindow.endDate}T00:00:00.000Z`).getTime();

  return publishedTime >= recentStart && publishedTime < recentEnd ? "recent" : "old";
}

export function parseIsoDurationToSeconds(duration: string | null | undefined) {
  if (!duration) return null;

  const match = duration.match(
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/
  );

  if (!match) return null;

  const [, years, months, weeks, days, hours, minutes, seconds] = match;
  const totalSeconds =
    Number(years ?? 0) * 31_536_000 +
    Number(months ?? 0) * 2_592_000 +
    Number(weeks ?? 0) * 604_800 +
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0);

  return Math.round(totalSeconds);
}

export function normalizeAnalyticsContentType(value: string | null | undefined): VideoContentType {
  const normalized = (value ?? "").toUpperCase();

  if (normalized.includes("SHORT")) return "short";
  if (normalized.includes("LIVE")) return "live";
  if (normalized.includes("VIDEO") || normalized.includes("VOD") || normalized.includes("UPLOAD")) {
    return "long";
  }

  return "unknown";
}

export function classifyVideoContentType(input: {
  analyticsContentType?: string | null;
  durationSeconds?: number | null;
}): VideoContentType {
  const analyticsType = normalizeAnalyticsContentType(input.analyticsContentType);
  if (analyticsType !== "unknown") return analyticsType;

  return "unknown";
}

export function normalizeReportDate(date: Date) {
  return formatDate(date);
}

function parseMonth(month: string): [number, number] {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid report month: ${month}`);
  }

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) {
    throw new Error(`Invalid report month: ${month}`);
  }

  return [year, monthNumber];
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
