import type { RangeDashboardData } from "@/lib/range-dashboard";
import type { DailyStatusData } from "@/lib/daily-status";
import { sumRecentRangeMetrics } from "@/lib/range-recent-metrics";

export type RangeRefreshProgress = { completed: number; total: number; failed: number; pending: number; unsaved: number };

// One channel/day per request keeps large ranges out of a single long-running HTTP request.
export async function refreshMissingRangeVideos(input: {
  data: RangeDashboardData;
  canViewRevenue: boolean;
  signal: AbortSignal;
  fetchDay: (day: string, channelId: string, signal: AbortSignal) => Promise<DailyStatusData>;
  update: (data: RangeDashboardData, progress: RangeRefreshProgress) => void;
}) {
  let data = input.data;
  const jobs = data.series.flatMap((series) => series.points
    .filter((point) => point.recentViews == null || point.recentWatchHours == null || (input.canViewRevenue && point.recentRevenue == null))
    .map((point) => ({ day: point.day, channelId: series.channel.channelId })));
  const progress: RangeRefreshProgress = { completed: 0, total: jobs.length, failed: 0, pending: 0, unsaved: 0 };
  input.update(data, { ...progress });
  await Promise.all(Array.from({ length: Math.min(2, jobs.length) }, async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      input.signal.throwIfAborted();
      try {
        const result = await input.fetchDay(job.day, job.channelId, input.signal);
        input.signal.throwIfAborted();
        const section = result.rows.find((row) => row.channelId === job!.channelId)?.recentVideos;
        if (result.date !== job.day) throw new Error("Unexpected reporting date.");
        if (section?.status === "available" && section.values) {
          const values = section.values;
          if (section.cacheWarning) progress.unsaved++;
          if (input.canViewRevenue && values.estimatedRevenue == null) progress.pending++;
          const series = data.series.map((series) => {
            if (series.channel.channelId !== job!.channelId) return series;
            const points = series.points.map((point) => point.day !== job!.day ? point : {
              ...point, recentViews: values.views, recentWatchHours: values.watchHours,
              recentRevenue: input.canViewRevenue ? values.estimatedRevenue ?? point.recentRevenue ?? null : null
            });
            return { ...series, points, totals: { ...series.totals, ...sumRecentRangeMetrics(points, input.canViewRevenue) } };
          });
          data = { ...data, series, totals: { ...data.totals, ...sumRecentRangeMetrics(series.map((series) => series.totals), input.canViewRevenue) } };
        } else if (section?.status === "missing") progress.pending++;
        else progress.failed++;
      } catch (error) {
        if (input.signal.aborted) throw error;
        progress.failed++;
      }
      progress.completed++;
      input.update(data, { ...progress });
    }
  }));
  return data;
}
