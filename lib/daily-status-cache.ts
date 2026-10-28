import { getDailyStatusWindow, getDailyStatusToday, type DailyStatusSection, type RecentVideoMetrics } from "@/lib/daily-status";

export const DAILY_STATUS_CACHE_VERSION = 1;
export const DAILY_STATUS_RESULTS_TABLE = "youtube_daily_video_cohort_metrics";
export type RecentVideoCacheRow = {
  channel_id: string;
  day: string;
  publication_start_date: string;
  publication_end_date: string;
  algorithm_version: number;
  views: number;
  watch_hours: number;
  video_count: number;
  fetched_at: string;
  estimated_revenue?: number | null;
  revenue_fetched_at?: string | null;
};

export function validRecentVideoCache(row: RecentVideoCacheRow, channelId: string, date: string) {
  const window = getDailyStatusWindow(date);
  return row.channel_id === channelId && row.day === date && row.algorithm_version === DAILY_STATUS_CACHE_VERSION &&
    row.publication_start_date === window.startDate && row.publication_end_date === window.endDate &&
    [row.views, row.watch_hours, row.video_count].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0) &&
    Number.isInteger(row.views) && Number.isInteger(row.video_count) && Number.isFinite(Date.parse(row.fetched_at)) &&
    (row.estimated_revenue === undefined || row.estimated_revenue === null || Number.isFinite(row.estimated_revenue));
}

export function isRecentVideoCacheFresh(row: RecentVideoCacheRow, now = new Date()) {
  const age = now.getTime() - Date.parse(row.fetched_at);
  const daysAgo = (Date.parse(`${getDailyStatusToday(now)}T00:00:00Z`) - Date.parse(`${row.day}T00:00:00Z`)) / 86_400_000;
  const ttl = daysAgo <= 7 ? 60 * 60_000 : 24 * 60 * 60_000;
  return age >= 0 && age < ttl;
}

function savedSection(row: RecentVideoCacheRow, stale: boolean, message?: string): DailyStatusSection<RecentVideoMetrics> {
  return {
    status: "available", values: { views: row.views, watchHours: row.watch_hours, videoCount: row.video_count,
      ...(row.estimated_revenue !== undefined ? { estimatedRevenue: row.estimated_revenue } : {}) },
    source: "cache", updatedAt: row.fetched_at, stale,
    ...(row.revenue_fetched_at ? { revenueUpdatedAt: row.revenue_fetched_at } : {}),
    ...(message ? { message } : {})
  };
}

export async function loadCachedRecentVideoStatus(input: {
  channelId: string;
  date: string;
  cached?: RecentVideoCacheRow;
  forceRefresh?: boolean;
  storedOnly?: boolean;
  now?: () => Date;
  fetch: () => Promise<DailyStatusSection<RecentVideoMetrics>>;
  save: (row: RecentVideoCacheRow) => Promise<void>;
}): Promise<DailyStatusSection<RecentVideoMetrics>> {
  const now = input.now ?? (() => new Date());
  const cached = input.cached && validRecentVideoCache(input.cached, input.channelId, input.date) ? input.cached : undefined;
  if (input.storedOnly && !input.forceRefresh) {
    return cached ? savedSection(cached, false) : { status: "missing", values: null,
      message: "The background job has not stored results for this date yet. Refresh data can fetch them now." };
  }
  if (cached && !input.forceRefresh && isRecentVideoCacheFresh(cached, now())) return savedSection(cached, false);
  let result: DailyStatusSection<RecentVideoMetrics>;
  try { result = await input.fetch(); }
  catch { result = { status: "error", values: null, message: "Recent-video data could not be loaded. Retry to try again." }; }
  if (result.status !== "available" || !result.values) {
    if (cached) return savedSection(cached, !isRecentVideoCacheFresh(cached, now()),
      "YouTube refresh failed. Showing the last saved result.");
    return result;
  }
  const updatedAt = now().toISOString();
  const window = getDailyStatusWindow(input.date);
  const revenue = result.values.estimatedRevenue;
  const values = { ...result.values, ...(revenue === null && cached?.estimated_revenue !== undefined ? { estimatedRevenue: cached.estimated_revenue } : {}) };
  const revenueUpdatedAt = typeof revenue === "number" ? updatedAt : cached?.revenue_fetched_at ?? null;
  const row: RecentVideoCacheRow = {
    channel_id: input.channelId, day: input.date, publication_start_date: window.startDate,
    publication_end_date: window.endDate, algorithm_version: DAILY_STATUS_CACHE_VERSION,
    views: values.views, watch_hours: values.watchHours, video_count: values.videoCount, fetched_at: updatedAt,
    estimated_revenue: values.estimatedRevenue ?? null, revenue_fetched_at: revenueUpdatedAt
  };
  const live = { ...result, values, source: "youtube" as const, updatedAt, stale: false,
    ...(revenueUpdatedAt ? { revenueUpdatedAt } : {}) };
  try {
    if (!validRecentVideoCache(row, input.channelId, input.date)) throw new Error("Invalid recent-video result.");
    await input.save(row);
  } catch {
    return { ...live, cacheWarning: "Could not save these results. The next visit may need to load YouTube again." };
  }
  return live;
}
