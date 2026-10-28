export type RecentRangeMetrics = {
  recentViews?: number | null;
  recentWatchHours?: number | null;
  recentRevenue?: number | null;
};

// A missing day or channel must never become a zero or a misleading partial total.
export function sumRecentRangeMetrics(values: RecentRangeMetrics[], canViewRevenue: boolean): RecentRangeMetrics {
  const sum = (key: keyof RecentRangeMetrics) => values.length && values.every((value) => value[key] != null)
    ? values.reduce((total, value) => total + value[key]!, 0) : null;
  return { recentViews: sum("recentViews"), recentWatchHours: sum("recentWatchHours"), recentRevenue: canViewRevenue ? sum("recentRevenue") : null };
}

// Display partial sums with explicit coverage; strict totals remain unchanged for exports.
export function recentMetricCoverage(values: RecentRangeMetrics[], key: keyof RecentRangeMetrics) {
  const available = values.filter((value) => typeof value[key] === "number" && Number.isFinite(value[key]));
  return { value: available.length ? available.reduce((total, value) => total + value[key]!, 0) : null,
    available: available.length, total: values.length, complete: values.length > 0 && available.length === values.length };
}
