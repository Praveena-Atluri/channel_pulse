export type WeeklyDateRange = {
  endDate: string;
  startDate: string;
};

const WEEKLY_ANALYTICS_LAG_DAYS = 2;

export function getDefaultWeeklyRange(now = new Date()): WeeklyDateRange {
  const end = getLatestWeeklyReportEndDate(now);
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 6);

  return {
    endDate: formatDate(end),
    startDate: formatDate(start)
  };
}

export function getLatestWeeklyReportEndDate(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - WEEKLY_ANALYTICS_LAG_DAYS));
}

export function getPreviousPeriodRange(range: WeeklyDateRange): WeeklyDateRange {
  const dayCount = getInclusiveDayCount(range.startDate, range.endDate);
  const end = parseDate(range.startDate);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - dayCount + 1);

  return {
    endDate: formatDate(end),
    startDate: formatDate(start)
  };
}

export function getTrailingWeeklyRanges(range: WeeklyDateRange, periodCount = 4): WeeklyDateRange[] {
  const ranges: WeeklyDateRange[] = [range];
  let cursor = range;

  for (let index = 1; index < periodCount; index += 1) {
    cursor = getPreviousPeriodRange(cursor);
    ranges.push(cursor);
  }

  return ranges.reverse();
}

export function getMonthToMonthRanges(weekEndDate: string) {
  const end = parseDate(weekEndDate);
  const monthStart = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  const previousMonthStart = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
  const previousMonthLastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0)).getUTCDate();
  const previousMonthEndDay = Math.min(end.getUTCDate(), previousMonthLastDay);
  const previousMonthEnd = new Date(
    Date.UTC(previousMonthStart.getUTCFullYear(), previousMonthStart.getUTCMonth(), previousMonthEndDay)
  );

  return {
    current: {
      endDate: formatDate(end),
      startDate: formatDate(monthStart)
    },
    previous: {
      endDate: formatDate(previousMonthEnd),
      startDate: formatDate(previousMonthStart)
    }
  };
}

function getInclusiveDayCount(startDate: string, endDate: string) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
