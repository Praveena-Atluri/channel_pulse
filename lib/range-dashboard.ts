import { DAILY_STATUS_RESULTS_TABLE, validRecentVideoCache, type RecentVideoCacheRow } from "@/lib/daily-status-cache";
import { sumRecentRangeMetrics } from "@/lib/range-recent-metrics";
import { createDatabaseAdminClient } from "@/lib/database";
import type { StoredYoutubeManagedChannel } from "@/lib/youtube-managed-channels";
import { calculateEngagementRate, rangeUsesMixedPublicViewMethodology } from "@/lib/youtube-performance-utils";

export type RangeMetricValues = {
  recentViews?: number | null;
  recentWatchHours?: number | null;
  recentRevenue?: number | null;
  estimatedRevenue: number | null;
  netSubscribers: number;
  views: number;
  engagedViews: number | null;
  engagementRate: number | null;
  watchHours: number;
};

export type RangeDailyPoint = RangeMetricValues & {
  day: string;
};

export type RangeChannelSeries = {
  channel: Pick<StoredYoutubeManagedChannel, "channelId" | "thumbnailUrl" | "title">;
  points: RangeDailyPoint[];
  totals: RangeMetricValues;
};

export type RangeDashboardData = {
  coverage: { firstDay: string | null; lastDay: string | null };
  endDate: string;
  generatedAt: string;
  recentUpdatedAt?: string | null;
  series: RangeChannelSeries[];
  startDate: string;
  totals: RangeMetricValues;
  engagedViewsAvailable: boolean;
  publicViewMethodologyWarning: boolean;
};

type MetricRow = {
  channel_id: string;
  day: string;
  estimated_minutes_watched: number | string | null;
  estimated_revenue: number | string | null;
  subscribers_gained: number | string | null;
  subscribers_lost: number | string | null;
  views: number | string | null;
  engaged_views: number | string | null;
};

const DB_PAGE_SIZE = 1000;

export async function getRangeDashboardData({
  canViewRevenue,
  channels,
  endDate,
  startDate
}: {
  canViewRevenue: boolean;
  channels: StoredYoutubeManagedChannel[];
  endDate: string;
  startDate: string;
}): Promise<RangeDashboardData> {
  const channelIds = channels.map((channel) => channel.channelId);
  const [rows, recentRows] = await Promise.all([getMetricRows(channelIds, startDate, endDate), getRecentRows(channelIds, startDate, endDate)]);
  const recentByDay = new Map(recentRows.filter((row) => validRecentVideoCache(row, row.channel_id, row.day)).map((row) => [`${row.channel_id}:${row.day}`, row]));
  const rowsByChannel = new Map(channels.map((channel) => [channel.channelId, [] as MetricRow[]]));

  for (const row of rows) rowsByChannel.get(row.channel_id)?.push(row);

  const series = channels.map((channel) => {
    const dailyRows = new Map((rowsByChannel.get(channel.channelId) ?? []).map((row) => [row.day, row]));
    const points: RangeDailyPoint[] = [];
    for (let time = Date.parse(`${startDate}T00:00:00Z`); time <= Date.parse(`${endDate}T00:00:00Z`); time += 86_400_000) {
      const day = new Date(time).toISOString().slice(0, 10);
      const row = dailyRows.get(day);
      const recent = recentByDay.get(`${channel.channelId}:${day}`);
      points.push({
        ...(row ? toPoint(row, canViewRevenue) : { day, estimatedRevenue: canViewRevenue ? 0 : null, netSubscribers: 0, views: 0, engagedViews: null, engagementRate: null, watchHours: 0 }),
        recentViews: recent?.views ?? null,
        recentWatchHours: recent?.watch_hours ?? null,
        recentRevenue: canViewRevenue ? recent?.estimated_revenue ?? null : null
      });
    }
    return {
      channel: {
        channelId: channel.channelId,
        thumbnailUrl: channel.thumbnailUrl,
        title: channel.title
      },
      points,
      totals: sumValues(points, canViewRevenue)
    };
  });
  const populatedDays = rows.map((row) => row.day).sort();

  return {
    coverage: {
      firstDay: populatedDays[0] ?? null,
      lastDay: populatedDays[populatedDays.length - 1] ?? null
    },
    endDate,
    generatedAt: new Date().toISOString(),
    recentUpdatedAt: recentRows.map((row) => row.fetched_at).filter(Boolean).sort()[0] ?? null,
    engagedViewsAvailable: rows.some((row) => row.engaged_views !== null && row.engaged_views !== undefined),
    publicViewMethodologyWarning: rangeUsesMixedPublicViewMethodology(startDate, endDate),
    series,
    startDate,
    totals: sumValues(series.map((item) => item.totals), canViewRevenue)
  };
}

async function getMetricRows(channelIds: string[], startDate: string, endDate: string) {
  if (channelIds.length === 0) return [];

  const db = createDatabaseAdminClient();
  const rows: MetricRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await db
      .from("youtube_channel_daily_metrics")
      .select(
        "channel_id,day,views,engaged_views,estimated_minutes_watched,subscribers_gained,subscribers_lost,estimated_revenue"
      )
      .in("channel_id", channelIds)
      .gte("day", startDate)
      .lte("day", endDate)
      .order("channel_id", { ascending: true })
      .order("day", { ascending: true })
      .range(offset, offset + DB_PAGE_SIZE - 1);

    if (error) throw error;
    rows.push(...((data ?? []) as MetricRow[]));
    if (!data || data.length < DB_PAGE_SIZE) break;
    offset += DB_PAGE_SIZE;
  }

  return rows;
}

function toPoint(row: MetricRow, canViewRevenue: boolean): RangeDailyPoint {
  const views = toNumber(row.views);
  const engagedViews = row.engaged_views === null || row.engaged_views === undefined ? null : toNumber(row.engaged_views);
  return {
    day: row.day,
    estimatedRevenue: canViewRevenue ? toNumber(row.estimated_revenue) : null,
    netSubscribers: toNumber(row.subscribers_gained) - toNumber(row.subscribers_lost),
    views,
    engagedViews,
    engagementRate: engagedViews === null ? null : calculateEngagementRate(engagedViews, views),
    watchHours: toNumber(row.estimated_minutes_watched) / 60
  };
}

function sumValues(values: RangeMetricValues[], canViewRevenue: boolean): RangeMetricValues {
  const totals = values.reduce<RangeMetricValues>(
    (sum, value) => ({
      estimatedRevenue: canViewRevenue
        ? (sum.estimatedRevenue ?? 0) + (value.estimatedRevenue ?? 0)
        : null,
      netSubscribers: sum.netSubscribers + value.netSubscribers,
      views: sum.views + value.views,
      engagedViews:
        sum.engagedViews === null && value.engagedViews === null
          ? null
          : (sum.engagedViews ?? 0) + (value.engagedViews ?? 0),
      engagementRate: null,
      watchHours: sum.watchHours + value.watchHours
    }),
    { estimatedRevenue: canViewRevenue ? 0 : null, netSubscribers: 0, views: 0, engagedViews: null, engagementRate: null, watchHours: 0 }
  );
  totals.engagementRate = totals.engagedViews === null ? null : calculateEngagementRate(totals.engagedViews, totals.views);
  return { ...totals, ...sumRecentRangeMetrics(values, canViewRevenue) };
}

function toNumber(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

async function getRecentRows(channelIds: string[], startDate: string, endDate: string): Promise<RecentVideoCacheRow[]> {
  if (!channelIds.length) return [];
  const db = createDatabaseAdminClient();
  const rows: RecentVideoCacheRow[] = [];
  for (let offset = 0; ; offset += DB_PAGE_SIZE) {
    const { data, error } = await db.from(DAILY_STATUS_RESULTS_TABLE)
      .select("channel_id,day,publication_start_date,publication_end_date,algorithm_version,views,watch_hours,video_count,fetched_at,estimated_revenue")
      .in("channel_id", channelIds).gte("day", startDate).lte("day", endDate)
      .order("channel_id", { ascending: true }).order("day", { ascending: true })
      .range(offset, offset + DB_PAGE_SIZE - 1);
    // The recent-video cache may not have been initialized yet. Keep all-video analytics usable.
    if (error) return [];
    rows.push(...((data ?? []) as RecentVideoCacheRow[]));
    if (!data || data.length < DB_PAGE_SIZE) return rows;
  }
}
