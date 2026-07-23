import { createDatabaseAdminClient } from "@/lib/database";
import type { StoredYoutubeManagedChannel } from "@/lib/youtube-managed-channels";

export type RangeMetricValues = {
  estimatedRevenue: number | null;
  netSubscribers: number;
  views: number;
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
  series: RangeChannelSeries[];
  startDate: string;
  totals: RangeMetricValues;
};

type MetricRow = {
  channel_id: string;
  day: string;
  estimated_minutes_watched: number | string | null;
  estimated_revenue: number | string | null;
  subscribers_gained: number | string | null;
  subscribers_lost: number | string | null;
  views: number | string | null;
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
  const rows = await getMetricRows(channels.map((channel) => channel.channelId), startDate, endDate);
  const rowsByChannel = new Map(channels.map((channel) => [channel.channelId, [] as MetricRow[]]));

  for (const row of rows) rowsByChannel.get(row.channel_id)?.push(row);

  const series = channels.map((channel) => {
    const points = (rowsByChannel.get(channel.channelId) ?? []).map((row) => toPoint(row, canViewRevenue));
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
        "channel_id,day,views,estimated_minutes_watched,subscribers_gained,subscribers_lost,estimated_revenue"
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
  return {
    day: row.day,
    estimatedRevenue: canViewRevenue ? toNumber(row.estimated_revenue) : null,
    netSubscribers: toNumber(row.subscribers_gained) - toNumber(row.subscribers_lost),
    views: toNumber(row.views),
    watchHours: toNumber(row.estimated_minutes_watched) / 60
  };
}

function sumValues(values: RangeMetricValues[], canViewRevenue: boolean): RangeMetricValues {
  return values.reduce<RangeMetricValues>(
    (sum, value) => ({
      estimatedRevenue: canViewRevenue
        ? (sum.estimatedRevenue ?? 0) + (value.estimatedRevenue ?? 0)
        : null,
      netSubscribers: sum.netSubscribers + value.netSubscribers,
      views: sum.views + value.views,
      watchHours: sum.watchHours + value.watchHours
    }),
    { estimatedRevenue: canViewRevenue ? 0 : null, netSubscribers: 0, views: 0, watchHours: 0 }
  );
}

function toNumber(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}
