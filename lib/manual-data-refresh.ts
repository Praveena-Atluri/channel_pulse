const REPORT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_MANUAL_REFRESH_MONTHS = 2;

export function isValidManualRefreshDate(value: string) {
  if (!REPORT_DATE_PATTERN.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isManualRefreshRangeValid(startDate: string, endDate: string) {
  if (!isValidManualRefreshDate(startDate) || !isValidManualRefreshDate(endDate)) return false;
  if (startDate > endDate) return false;

  return endDate <= getMaximumManualRefreshEndDate(startDate);
}

export function getMaximumManualRefreshEndDate(startDate: string) {
  if (!isValidManualRefreshDate(startDate)) return "";

  const start = new Date(`${startDate}T00:00:00.000Z`);
  const maximumExclusive = new Date(start);
  maximumExclusive.setUTCMonth(maximumExclusive.getUTCMonth() + MAX_MANUAL_REFRESH_MONTHS);
  maximumExclusive.setUTCDate(maximumExclusive.getUTCDate() - 1);
  return maximumExclusive.toISOString().slice(0, 10);
}
